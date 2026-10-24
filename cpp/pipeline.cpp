#include "pipeline.hpp"
#include <curl/curl.h>
#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>

namespace onetype {
namespace {
std::string text(const json& value) {
    if (value.is_string()) return value.get<std::string>();
    if (value.is_number_integer() || value.is_number_unsigned()) return value.dump();
    return "";
}
std::string field(const json& row, const std::string& key) {return row.contains(key) ? text(row[key]) : "";}
std::string trim(const std::string& input) {
    std::string result; bool space = false;
    for (unsigned char c : input) {
        if (std::isspace(c)) {space = !result.empty(); continue;}
        if (space) result += ' ';
        result += static_cast<char>(c); space = false;
    }
    return result;
}
std::string lower(std::string input) {for (auto& c : input) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return input;}
json number(const json& input) {
    if (input.is_number()) {double value = input.get<double>(); return std::isfinite(value) ? json(value) : json(nullptr);}
    auto value = trim(text(input));
    if (!value.empty() && value.front() == '$') value.erase(value.begin());
    static const std::regex grouped(R"([+-]?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)");
    if (value.find(',') != std::string::npos && !std::regex_match(value,grouped)) return nullptr;
    value.erase(std::remove(value.begin(),value.end(),','),value.end());
    static const std::regex numeric(R"([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))");
    if (!std::regex_match(value,numeric)) return nullptr;
    try {double result = std::stod(value); return std::isfinite(result) ? json(result) : json(nullptr);} catch (...) {return nullptr;}
}
json getNumber(const json& row, const char* primary, const char* fallback = "") {
    if (row.contains(primary)) return number(row[primary]);
    return *fallback && row.contains(fallback) ? number(row[fallback]) : json(nullptr);
}
std::string rowId(const json& row) {
    const auto id = productId(row.value("product_id",json(nullptr)));
    const auto url = productId(row.value("product_url",json(nullptr)));
    if (!id.empty() && !url.empty() && id != url) throw std::invalid_argument("product_id and product_url identify different products");
    return !id.empty() ? id : url;
}
bool validDate(const std::string& input) {
    const bool dateOnly = input.size() == 10;
    if (!dateOnly && input.size() != 20) return false;
    std::tm parsed{};
    std::istringstream stream(input); stream >> std::get_time(&parsed,dateOnly ? "%Y-%m-%d" : "%Y-%m-%dT%H:%M:%SZ");
    if (stream.fail()) return false;
    const auto stamp = timegm(&parsed); if (stamp < 0) return false;
    std::tm normalized{}; gmtime_r(&stamp,&normalized);
    std::ostringstream check; check << std::put_time(&normalized,dateOnly ? "%Y-%m-%d" : "%Y-%m-%dT%H:%M:%SZ");
    return check.str() == input;
}
std::string nowUtc() {
    const auto value = std::time(nullptr); std::tm date{}; gmtime_r(&value,&date);
    std::ostringstream out; out << std::put_time(&date,"%Y-%m-%dT%H:%M:%SZ"); return out.str();
}
json stock(const json& raw) {
    const auto original = trim(text(raw)), value = lower(original);
    json result = {{"raw",raw},{"status","unknown"},{"reported_quantity",nullptr}};
    if (value == "in stock") result["status"] = "in_stock";
    else if (value == "out of stock") result["status"] = "out_of_stock";
    else if (value == "no longer stocked") result["status"] = "no_longer_stocked";
    else if (value == "backorder") result["status"] = "backorder";
    else if (std::regex_match(value,std::regex(R"([0-9]+(?: in stock)?)"))) {
        try {const auto quantity = std::stoll(value); result["reported_quantity"] = quantity; result["status"] = quantity > 0 ? "in_stock" : "out_of_stock";} catch (...) {}
    }
    // Negative API sentinel values are not stock quantities and stay unknown.
    return result;
}
json specification(const json& row) {
    auto value = getNumber(row,"value");
    if (value.is_null() || value.get<double>() < 0) throw std::invalid_argument("Specification value must be a nonnegative number");
    const auto property = lower(trim(field(row,"property"))), unit = trim(field(row,"unit"));
    if ((property == "clock" || property == "clock_hz") && (unit == "MHz" || unit == "Hz"))
        return {{"property","clock_hz"},{"value",value.get<double>() * (unit == "MHz" ? 1000000 : 1)},{"unit","Hz"},{"qualifier",row.value("qualifier",json(nullptr))}};
    if ((property == "sram" || property == "sram_kb") && (unit == "kB" || unit == "KB"))
        return {{"property","sram_kb"},{"value",value},{"unit","kB as published"}};
    if ((property == "flash" || property == "flash_mb") && unit == "MB")
        return {{"property","flash_mb"},{"value",value},{"unit","MB as published"}};
    throw std::invalid_argument("Supported specifications: clock Hz/MHz, sram kB/KB, flash MB; memory bytes are not inferred");
}
bool matches(const json& product, const std::string& manufacturer, const std::string& category) {
    return (manufacturer.empty() || product.at("manufacturer").get<std::string>() == manufacturer) &&
           (category.empty() || product.at("category_id").get<std::string>() == category);
}
json sourceMeta(const json& source) {auto result = source; result.erase("records"); result["record_count"] = source.at("records").size(); return result;}
json sourceStats(const json& source, const Compiled& model) {
    std::size_t unmatched = 0;
    for (const auto& row : model.quarantine) if (row.at("source_id") == source.at("id")) ++unmatched;
    std::set<std::string> unique;
    for (const auto& row : source.at("records")) unique.insert(row.dump());
    return {{"record_count",source.at("records").size()},{"unique_records",unique.size()},
            {"duplicate_records",source.at("records").size()-unique.size()},{"matched",unique.size()-unmatched},{"unmatched",unmatched}};
}
json read(const std::filesystem::path& file) {std::ifstream in(file); if (!in) throw std::runtime_error("Cannot read "+file.string()); return json::parse(in);}
}

std::string productId(const json& value) {
    auto input = trim(text(value));
    std::smatch match;
    static const std::regex pattern(R"((?:ADA:?|adafruit:)?([0-9]+))",std::regex::icase);
    static const std::regex url(R"(https://(?:www\.)?adafruit\.com/product/([0-9]+)/?)",std::regex::icase);
    if (!std::regex_match(input,match,pattern) && !std::regex_match(input,match,url)) return "";
    auto id = match[1].str(); const auto first = id.find_first_not_of('0');
    if (first == std::string::npos || id.size() > 12) return "";
    return id.substr(first);
}

json cleanCatalog(const json& row) {
    const auto id = rowId(row); if (id.empty()) throw std::invalid_argument("Catalog row requires an Adafruit product ID or exact product URL");
    const auto name = trim(field(row,"product_name")); if (name.empty()) throw std::invalid_argument("Catalog product_name is required");
    auto price = getNumber(row,"product_price","price");
    if (!price.is_null() && price.get<double>() < 0) price = nullptr;
    auto weight = getNumber(row,"product_shipping_weight","shipping_weight");
    const auto unit = row.contains("product_shipping_weight") ? "g" : field(row,"weight_unit");
    if (!weight.is_null()) {
        if (unit == "kg") weight = weight.get<double>() * 1000;
        else if (unit != "g") weight = nullptr;
        if (!weight.is_null() && weight.get<double>() < 0) weight = nullptr;
    }
    static const std::regex currencyCode("[A-Z]{3}");
    auto currency = field(row,"currency"); if (!std::regex_match(currency,currencyCode)) currency.clear();
    json flags = json::array();
    if (price.is_null()) flags.push_back("price_missing_or_invalid");
    if (weight.is_null()) flags.push_back("weight_missing_invalid_or_unit_unknown");
    if (currency.empty()) flags.push_back("currency_unconfirmed");
    const auto available = stock(row.value("product_stock",row.value("stock",json(nullptr))));
    if (available.at("status") == "unknown") flags.push_back("availability_unknown");
    return {{"id","ADA:"+id},{"product_id",id},{"name",name},
            {"manufacturer",trim(field(row,"product_manufacturer"))},{"retailer_mpn_raw",row.value("product_mpn",json(nullptr))},
            {"category_id",field(row,"product_master_category")},{"price_value",price},
            {"currency",currency.empty() ? json(nullptr) : json(currency)}, {"shipping_weight_g",weight},
            {"availability",available},{"virtual",field(row,"products_virtual") == "1"},
            {"url","https://www.adafruit.com/product/"+id},{"quality_flags",flags}};
}

json validateSource(json source) {
    if (!source.is_object()) throw std::invalid_argument("Supply a source object");
    static const std::regex sourceId("[A-Za-z0-9_.:-]{1,80}");
    if (!std::regex_match(field(source,"id"),sourceId)) throw std::invalid_argument("Source id must contain 1-80 letters, digits, dots, dashes, colons or underscores");
    const std::set<std::string> kinds{"catalog","observations","specifications","documents","inventory","purchase_orders","communications"};
    const auto kind = field(source,"kind"); if (!kinds.count(kind)) throw std::invalid_argument("Unknown source kind");
    if (trim(field(source,"label")).empty()) throw std::invalid_argument("Source label is required");
    if (!validDate(field(source,"captured_at"))) throw std::invalid_argument("captured_at requires YYYY-MM-DD or UTC YYYY-MM-DDTHH:MM:SSZ");
    if (!source.contains("records") || !source["records"].is_array() || source["records"].empty() || source["records"].size() > 20000) throw std::invalid_argument("Supply 1-20,000 source records");
    std::map<std::string,json> seen;
    for (std::size_t i = 0; i < source["records"].size(); ++i) {
        const auto& row = source["records"][i];
        try {
            if (!row.is_object()) throw std::invalid_argument("Every record must be an object");
            const auto id = rowId(row);
            if (kind == "catalog") cleanCatalog(row);
            else if (id.empty() && trim(field(row,"product_name")).empty()) throw std::invalid_argument("Supply product_id, product_url, or a product_name for review");
            if (kind == "specifications") specification(row);
            if (kind == "documents" && (field(row,"title").empty() || !std::regex_match(field(row,"url"),std::regex(R"(https://[^\s]+)")))) throw std::invalid_argument("Documents require a title and HTTPS url");
            if (kind == "inventory" || kind == "purchase_orders") {
                const auto qty = getNumber(row,"quantity");
                if (qty.is_null() || qty.get<double>() < 0 || std::floor(qty.get<double>()) != qty.get<double>() || qty.get<double>() > 1000000000) throw std::invalid_argument("quantity must be a whole number from 0 to 1 billion");
                if (field(row,kind == "inventory" ? "warehouse_id" : "purchase_order_id").empty()) throw std::invalid_argument("Supply warehouse_id or purchase_order_id as appropriate");
            }
            if (kind == "communications" && field(row,"subject").empty()) throw std::invalid_argument("Communications require a subject");
            const auto key = kind == "catalog" ? id : field(row,"record_id");
            if (!key.empty()) {
                if (seen.count(key) && seen.at(key) != row) throw std::invalid_argument("Conflicting duplicate record ID in this source: "+key);
                seen[key] = row;
            }
        } catch (const std::exception& e) {throw std::invalid_argument("Row "+std::to_string(i+1)+": "+e.what());}
    }
    return source;
}

json csvRecords(const std::string& input) {
    std::vector<std::vector<std::string>> rows; std::vector<std::string> row; std::string cell;
    bool quoted = false, afterQuote = false, touched = false;
    auto endCell = [&] {row.push_back(cell); cell.clear(); afterQuote = false;};
    auto endRow = [&] {endCell(); if (row.size() != 1 || !row[0].empty()) rows.push_back(row); row.clear(); touched = false;};
    std::size_t begin = input.size() >= 3 && input.substr(0,3) == "\xef\xbb\xbf" ? 3 : 0;
    for (std::size_t i = begin; i < input.size(); ++i) {
        const char c = input[i]; touched = true;
        if (quoted) {
            if (c == '"') {if (i+1 < input.size() && input[i+1] == '"') {cell += '"'; ++i;} else {quoted = false; afterQuote = true;}}
            else cell += c;
        } else if (c == ',') endCell();
        else if (c == '\n' || c == '\r') {if (c == '\r' && i+1 < input.size() && input[i+1] == '\n') ++i; endRow();}
        else if (c == '"') {if (!cell.empty() || afterQuote) throw std::invalid_argument("CSV quote must start a field"); quoted = true;}
        else {if (afterQuote) throw std::invalid_argument("Unexpected text after a closing CSV quote"); cell += c;}
        if (rows.size() > 20001) throw std::invalid_argument("CSV exceeds 20,000 data rows");
    }
    if (quoted) throw std::invalid_argument("Unclosed quoted CSV field");
    if (touched || !row.empty() || !cell.empty()) endRow();
    if (rows.empty()) throw std::invalid_argument("CSV has no header");
    const auto headers = rows.front(); std::set<std::string> names;
    for (const auto& header : headers) if (trim(header).empty() || !names.insert(trim(header)).second) throw std::invalid_argument("CSV headers must be nonempty and unique");
    json records = json::array();
    for (std::size_t i = 1; i < rows.size(); ++i) {
        if (rows[i].size() != headers.size()) throw std::invalid_argument("CSV row "+std::to_string(i+1)+" has a different number of columns than the header");
        json record = json::object(); for (std::size_t column = 0; column < headers.size(); ++column) record[trim(headers[column])] = rows[i][column]; records.push_back(record);
    }
    if (records.empty()) throw std::invalid_argument("CSV contains no data rows");
    return records;
}

Compiled compile(const json& state) {
    Compiled model;
    std::vector<json> sources;
    for (const auto& source : state.at("sources")) sources.push_back(validateSource(source));
    std::stable_sort(sources.begin(),sources.end(),[](const json& a,const json& b){return a.at("captured_at").get<std::string>() < b.at("captured_at").get<std::string>();});
    for (const auto& source : sources) if (source.at("kind") == "catalog") {
        for (const auto& row : source.at("records")) {
            auto clean = cleanCatalog(row); const auto id = clean.at("product_id").get<std::string>();
            clean["source_id"] = source.at("id"); clean["captured_at"] = source.at("captured_at");
            model.products[id] = clean;
        }
    }
    for (const auto& source : sources) {
        std::set<std::string> duplicates;
        for (std::size_t i = 0; i < source.at("records").size(); ++i) {
            const auto& row = source.at("records")[i];
            if (!duplicates.insert(row.dump()).second) continue;
            ++model.recordCount;
            const auto id = rowId(row);
            json linked = {{"source_id",source.at("id")},{"source_label",source.at("label")},{"kind",source.at("kind")},
                           {"captured_at",source.at("captured_at")},{"record_index",i},{"raw",row},
                           {"match_basis","exact_retailer_id_or_URL"}};
            if (id.empty() || !model.products.contains(id)) {
                linked["status"] = "unmatched"; linked["reason"] = id.empty() ? "No exact retailer identifier; title similarity requires review" : "Product identifier is absent from the loaded catalog";
                linked["candidate_ids"] = json::array();
                const auto name = lower(trim(field(row,"product_name")));
                if (!name.empty()) for (const auto& product : model.products.items()) if (lower(product.value().at("name").get<std::string>()) == name) linked["candidate_ids"].push_back(product.key());
                model.quarantine.push_back(linked); continue;
            }
            ++model.matchedRecords;
            linked["product_id"] = id;
            if (source.at("kind") == "specifications") {
                linked["normalized"] = specification(row);
                linked["reference_priority"] = source.value("_trusted_reference",false) ? 1 : 0;
            } else if (source.at("kind") == "catalog") linked["normalized"] = cleanCatalog(row);
            else if (source.at("kind") == "inventory" || source.at("kind") == "purchase_orders") {
                linked["normalized"] = row; linked["normalized"]["quantity"] = getNumber(row,"quantity");
            } else if (source.at("kind") == "observations") {
                linked["normalized"] = {{"availability",stock(row.value("availability",json(nullptr)))},{"price_value",getNumber(row,"price")}};
            }
            if (!model.related.contains(id)) model.related[id] = json::array();
            model.related[id].push_back(linked);
        }
    }
    for (auto& product : model.products.items()) {
        const auto& id = product.key();
        product.value()["linked_records"] = model.related.contains(id) ? model.related.at(id).size() : 0;
        std::map<std::string,std::vector<json>> groups;
        for (const auto& record : model.related.value(id,json::array())) if (record.at("kind") == "specifications") groups[record.at("normalized").at("property").get<std::string>()].push_back(record);
        product.value()["specifications"] = json::array();
        for (const auto& [property, claims] : groups) {
            std::set<std::string> allValues, referenceValues; json selected = nullptr;
            for (const auto& claim : claims) {
                const auto& normal = claim.at("normalized");
                const auto token = json{{"property",normal.at("property")},{"value",normal.at("value")},{"unit",normal.at("unit")}}.dump(); allValues.insert(token);
                if (claim.at("reference_priority") == 1) {referenceValues.insert(token); selected = claim.at("normalized");}
            }
            if (referenceValues.empty() && allValues.size() == 1) selected = claims.front().at("normalized");
            if (referenceValues.size() > 1) selected = nullptr;
            json resolution = {{"property",property},{"selected",selected},{"claim_count",claims.size()},
                               {"status",allValues.size() > 1 ? (selected.is_null() ? "conflict_requires_review" : "conflict_reference_selected") : "claims_agree"},
                               {"basis",referenceValues.size() == 1 ? "Bundled manually reviewed manufacturer reference; all original claims retained" : "Agreement or unresolved disagreement among imported claims"}};
            product.value()["specifications"].push_back(resolution);
            if (allValues.size() > 1) {resolution["product_id"] = id; resolution["claims"] = claims; model.conflicts.push_back(resolution);}
        }
    }
    return model;
}

json pearson(const json& points) {
    const auto n = points.size();
    if (n < 8) return {{"r",nullptr},{"n",n},{"status","insufficient_pairs"},{"reason","At least 8 complete product pairs are required for this exploratory display"}};
    long double scaleX = 0, scaleY = 0;
    for (const auto& p : points) {scaleX = std::max(scaleX,std::abs(static_cast<long double>(p.at("x").get<double>()))); scaleY = std::max(scaleY,std::abs(static_cast<long double>(p.at("y").get<double>())));}
    if (scaleX == 0 || scaleY == 0) return {{"r",nullptr},{"n",n},{"status","constant_variable"},{"reason","Both variables need variation"}};
    long double meanX = 0, meanY = 0;
    for (const auto& p : points) {meanX += p.at("x").get<double>()/scaleX; meanY += p.at("y").get<double>()/scaleY;}
    meanX /= n; meanY /= n;
    long double xx = 0, yy = 0, xy = 0;
    for (const auto& p : points) {const auto x = p.at("x").get<double>()/scaleX-meanX, y = p.at("y").get<double>()/scaleY-meanY; xx += x*x; yy += y*y; xy += x*y;}
    if (xx <= 0 || yy <= 0) return {{"r",nullptr},{"n",n},{"status","constant_variable"},{"reason","Both variables need variation"}};
    return {{"r",std::clamp(static_cast<double>(xy/std::sqrt(xx*yy)),-1.0,1.0)},{"n",n},{"status","calculated"}};
}

Pipeline::Pipeline(const std::filesystem::path& file) : file_(file),state_(read(file)),model_(compile(state_)) {}
void Pipeline::save(const json& state) const {
    const auto temporary = file_.string()+".tmp";
    {std::ofstream out(temporary,std::ios::trunc); if (!out) throw std::runtime_error("Cannot write workspace data"); out << state.dump(2) << '\n'; out.flush(); if (!out) throw std::runtime_error("Workspace write failed");}
    std::filesystem::rename(temporary,file_);
}
json Pipeline::overview() const {
    std::lock_guard<std::mutex> lock(mutex_);
    json sources = json::array(), categoryLabels = json::object(); std::set<std::string> manufacturers,categories; std::string latest;
    for (const auto& source : state_.at("sources")) {auto meta = sourceMeta(source); meta.erase("category_labels"); meta.update(sourceStats(source,model_)); sources.push_back(meta); if (source.contains("category_labels")) categoryLabels.update(source.at("category_labels")); if (field(source,"kind") == "catalog") latest = std::max(latest,field(source,"captured_at"));}
    for (const auto& p : model_.products.items()) {if (!field(p.value(),"manufacturer").empty()) manufacturers.insert(field(p.value(),"manufacturer")); if (!field(p.value(),"category_id").empty()) categories.insert(field(p.value(),"category_id"));}
    std::size_t rawCount = 0; for (const auto& source : state_.at("sources")) rawCount += source.at("records").size();
    return {{"company","Adafruit"},{"revision",state_.at("revision")},{"products",model_.products.size()},
            {"records",rawCount},{"distinct_records",model_.recordCount},{"matched_records",model_.matchedRecords},{"quarantined",model_.quarantine.size()},
            {"conflicts",model_.conflicts.size()},{"catalog_captured_at",latest},{"sources",sources},
            {"manufacturers",manufacturers},{"categories",categories},{"category_labels",categoryLabels},{"refresh_cooldown_seconds",15}};
}
json Pipeline::products(const std::string& q,const std::string& manufacturer,const std::string& category,int page) const {
    std::lock_guard<std::mutex> lock(mutex_); json result = json::array(); std::size_t count = 0;
    for (const auto& p : model_.products.items()) {
        if (!matches(p.value(),manufacturer,category)) continue;
        if (!q.empty() && lower(p.value().dump()).find(lower(q)) == std::string::npos) continue;
        if (count >= static_cast<std::size_t>(page*50) && result.size() < 50) result.push_back(p.value());
        ++count;
    }
    return {{"rows",result},{"total",count},{"page",page},{"page_size",50},{"revision",state_.at("revision")}};
}
json Pipeline::product(const std::string& input) const {
    std::lock_guard<std::mutex> lock(mutex_); const auto id = productId(input);
    if (!model_.products.contains(id)) throw std::out_of_range("Product not found in the loaded catalog");
    return {{"product",model_.products.at(id)},{"records",model_.related.value(id,json::array())},{"revision",state_.at("revision")}};
}
json Pipeline::patterns(const std::string& manufacturer,const std::string& category) const {
    std::lock_guard<std::mutex> lock(mutex_); json pairs = json::array(); std::size_t filtered = 0;
    std::map<std::string,json> groups;
    for (const auto& p : model_.products.items()) {
        if (!matches(p.value(),manufacturer,category)) continue;
        ++filtered; const auto& v = p.value();
        if (v.at("virtual") == true || v.at("price_value").is_null() || v.at("shipping_weight_g").is_null() || v.at("shipping_weight_g").get<double>() <= 0) continue;
        const auto group = v.at("source_id").get<std::string>()+"|"+v.at("currency").dump();
        if (!groups.count(group)) groups[group] = json::array();
        groups[group].push_back({{"product_id",p.key()},{"name",v.at("name")},{"x",v.at("shipping_weight_g")},{"y",v.at("price_value")}});
    }
    // Never combine price units across different capture sources/currencies.
    std::string scope;
    for (const auto& [group, rows] : groups) if (rows.size() > pairs.size()) {pairs = rows; scope = group;}
    auto result = pearson(pairs); json plotted = json::array(), differences = json::array();
    for (const auto& product : model_.products.items()) {
        const auto& latest = product.value();
        for (const auto& record : model_.related.value(product.key(),json::array())) {
            if (record.at("kind") != "observations" || record.at("captured_at").get<std::string>() >= latest.at("captured_at").get<std::string>()) continue;
            const auto& older = record.at("normalized").at("availability");
            const auto currentStatus = latest.at("availability").at("status");
            if (older.at("status") == "unknown" || currentStatus == "unknown" || older.at("status") == currentStatus) continue;
            differences.push_back({{"product_id",product.key()},{"older_status",older.at("status")},{"older_captured_at",record.at("captured_at")},
                                   {"latest_status",currentStatus},{"latest_captured_at",latest.at("captured_at")},
                                   {"source_ids",json::array({record.at("source_id"),latest.at("source_id")})},
                                   {"scope","Different dated public reports, not a warehouse stock change or causal explanation"}});
        }
    }
    for (std::size_t i = 0; i < pairs.size(); i += std::max<std::size_t>(1,(pairs.size()+199)/200)) plotted.push_back(pairs[i]);
    // Include the actual range extremes so a sample cannot hide the outliers
    // that influence a coefficient calculated on the full cohort.
    if (!pairs.empty()) for (const auto* axis : {"x","y"}) {
        auto compare = [axis](const json& a,const json& b){return a.at(axis).get<double>() < b.at(axis).get<double>();};
        const auto extremes = std::minmax_element(pairs.begin(),pairs.end(),compare);
        for (const auto& point : {*extremes.first,*extremes.second}) {
            const bool exists = std::any_of(plotted.begin(),plotted.end(),[&](const json& row){return row.at("product_id") == point.at("product_id");});
            if (!exists) plotted.push_back(point);
        }
    }
    result.update({{"filtered_products",filtered},{"excluded_products",filtered-pairs.size()},{"points",plotted},
                   {"plotted_count",plotted.size()},{"price_source_group",scope},{"x_label","Shipping weight (g)"},{"y_label","Displayed price units (currency may be unconfirmed)"},
                   {"conflicts",model_.conflicts},{"quarantine",model_.quarantine},{"availability_differences",differences},
                   {"interpretation","Exploratory cross-sectional association. Product mix, packaging and outliers can dominate it. It does not establish causation, demand, profitability or inventory performance."}});
    return result;
}
json Pipeline::preview(const json& input) const {
    auto source = validateSource(input); source["_trusted_reference"] = false; source["ingestion_method"] = "user_upload";
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& old : state_.at("sources")) if (old.at("id") == source.at("id")) {
        if (old == source) return {{"duplicate",true},{"revision",state_.at("revision")},{"source",sourceMeta(source)},{"stats",sourceStats(source,model_)}};
        throw Conflict("Source ID already exists with different content. Use a new source ID for a new capture.");
    }
    auto draft = state_; draft["sources"].push_back(source); auto compiled = compile(draft);
    json unmatched = json::array(); for (const auto& row : compiled.quarantine) if (row.at("source_id") == source.at("id")) unmatched.push_back(row);
    return {{"duplicate",false},{"revision",state_.at("revision")},{"source",sourceMeta(source)},{"stats",sourceStats(source,compiled)},
            {"unmatched",unmatched},{"product_count_after",compiled.products.size()},{"conflicts_after",compiled.conflicts.size()}};
}
json Pipeline::import(const json& input,int expectedRevision) {
    auto source = validateSource(input); source["_trusted_reference"] = false; source["ingestion_method"] = "user_upload";
    std::lock_guard<std::mutex> lock(mutex_);
    if (state_.at("revision") != expectedRevision) throw Conflict("Workspace changed. Preview again before importing.");
    for (const auto& old : state_.at("sources")) if (old.at("id") == source.at("id")) {
        if (old == source) return {{"duplicate",true},{"revision",state_.at("revision")}};
        throw Conflict("Source ID already exists with different content");
    }
    auto next = state_; next["sources"].push_back(source); next["revision"] = expectedRevision+1;
    auto compiled = compile(next); save(next); state_ = std::move(next); model_ = std::move(compiled);
    return {{"duplicate",false},{"revision",state_.at("revision")},{"stats",sourceStats(source,model_)}};
}
json Pipeline::exportState() const {std::lock_guard<std::mutex> lock(mutex_); return state_;}

namespace {
std::size_t receive(char* data,std::size_t size,std::size_t count,void* output) {
    auto& body = *static_cast<std::string*>(output); const auto bytes = size*count;
    if (body.size()+bytes > 25*1024*1024) return 0;
    body.append(data,bytes); return bytes;
}
}
json Pipeline::refresh() {
    {
        std::lock_guard<std::mutex> lock(mutex_); const auto now = std::chrono::steady_clock::now();
        if (fetching_) throw Conflict("Catalog refresh is already running");
        if (lastFetch_.time_since_epoch().count() && now-lastFetch_ < std::chrono::seconds(15)) throw Conflict("Please wait 15 seconds between catalog requests (Adafruit rate limit)");
        fetching_ = true; lastFetch_ = now;
    }
    try {
        std::string body; CURL* curl = curl_easy_init(); if (!curl) throw std::runtime_error("HTTPS initialization failed");
        curl_easy_setopt(curl,CURLOPT_URL,"https://www.adafruit.com/api/products");
        curl_easy_setopt(curl,CURLOPT_USERAGENT,"OneType-local-prototype/0.2");
        curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,receive); curl_easy_setopt(curl,CURLOPT_WRITEDATA,&body);
        curl_easy_setopt(curl,CURLOPT_TIMEOUT,30L); curl_easy_setopt(curl,CURLOPT_CONNECTTIMEOUT,10L);
        curl_easy_setopt(curl,CURLOPT_SSL_VERIFYPEER,1L); curl_easy_setopt(curl,CURLOPT_SSL_VERIFYHOST,2L);
        const auto status = curl_easy_perform(curl); long http = 0; curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&http); curl_easy_cleanup(curl);
        if (status != CURLE_OK || http != 200) throw std::runtime_error("Adafruit API request failed (HTTP "+std::to_string(http)+"). Existing data was retained.");
        const auto payload = json::parse(body); if (!payload.is_array()) throw std::runtime_error("Adafruit returned an unexpected catalog format");
        json rows = json::array();
        for (const auto& row : payload) {
            json facts = json::object();
            for (const auto* key : {"product_id","product_name","product_model","product_mpn","product_master_category","product_manufacturer","product_price","product_shipping_weight","product_url","product_stock","discontinue_status","products_virtual","date_added"}) if (row.contains(key)) facts[key] = row[key];
            rows.push_back(facts);
        }
        const auto captured = nowUtc();
        auto source = validateSource({{"id","API_"+std::to_string(std::time(nullptr))},{"kind","catalog"},{"label","Official Adafruit API catalog"},
                                     {"url","https://www.adafruit.com/api/products"},{"captured_at",captured},{"ingestion_method","official_api_https"},{"_trusted_reference",false},{"records",rows}});
        std::lock_guard<std::mutex> lock(mutex_); auto next = state_; next["sources"].push_back(source); next["revision"] = state_.at("revision").get<int>()+1;
        auto compiled = compile(next); save(next); state_ = std::move(next); model_ = std::move(compiled); fetching_ = false;
        return {{"revision",state_.at("revision")},{"records",rows.size()},{"captured_at",captured},{"source_id",source.at("id")}};
    } catch (...) {std::lock_guard<std::mutex> lock(mutex_); fetching_ = false; throw;}
}
}
