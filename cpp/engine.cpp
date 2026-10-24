#include "engine.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <sstream>

namespace onetype {
namespace {
std::string str(const json& o,const std::string& k,const std::string& fallback="") {
    if(!o.contains(k)) return fallback;
    if(!o.at(k).is_string()) throw std::invalid_argument(k+" must be text");
    return o.at(k).get<std::string>();
}
void keys(const json& o,const std::set<std::string>& allowed) {
    if(!o.is_object()) throw std::invalid_argument("Expected a JSON object");
    for(const auto& item:o.items()) if(!allowed.count(item.key())) throw std::invalid_argument("Unknown field: "+item.key());
}
json spec(const json& p,const std::string& name) {
    for(const auto& s:p.at("specifications")) if(s.at("property")==name && !s.at("selected").is_null()) return s.at("selected").at("value");
    return nullptr;
}
json metric(const json& p,const std::string& name) {
    if(name=="price_value" || name=="shipping_weight_g") return p.at(name);
    if(name=="public_quantity") return p.at("availability").at("reported_quantity");
    if(name=="clock_mhz") {const auto n=spec(p,"clock_hz");return n.is_null()?json(nullptr):json(n.get<double>()/1000000);}
    return spec(p,name);
}
bool isFinite(const json& n) {return n.is_number() && std::isfinite(n.get<double>());}
bool matches(const json& p,const json& f) {
    for(const auto* key:{"manufacturer","category_id"}) if(f.contains(key) && p.at(key)!=f.at(key)) return false;
    if(f.contains("availability") && p.at("availability").at("status")!=f.at("availability")) return false;
    if(f.contains("min_price") && (!isFinite(p.at("price_value")) || p.at("price_value").get<double>()<f.at("min_price").get<double>())) return false;
    if(f.contains("max_price") && (!isFinite(p.at("price_value")) || p.at("price_value").get<double>()>f.at("max_price").get<double>())) return false;
    return true;
}
std::string incomplete(const json& p,const std::string& x,const std::string& y) {
    if(p.at("virtual")==true) return "virtual_product";
    const auto a=metric(p,x),b=metric(p,y);
    if(!isFinite(a) || !isFinite(b)) return "missing_or_unresolved_metric";
    if((x=="shipping_weight_g" && a.get<double>()<=0) || (y=="shipping_weight_g" && b.get<double>()<=0)) return "nonpositive_shipping_weight";
    return "";
}
std::string priceGroup(const json& p,const std::string& x,const std::string& y) {
    return x=="price_value" || y=="price_value" ? p.at("source_id").get<std::string>()+"|"+p.at("currency").dump() : "normalized_metric_units";
}
json analyze(const json& products,const std::string& x,const std::string& y) {
    std::map<std::string,json> groups;
    for(const auto& p:products) if(incomplete(p,x,y).empty()) {
        const auto key=priceGroup(p,x,y);
        if(!groups.count(key)) groups[key]=json::array();
        groups[key].push_back({{"product_id",p.at("id")},{"x",metric(p,x)},{"y",metric(p,y)}});
    }
    json points=json::array();std::string chosen;
    for(const auto& [key,rows]:groups) if(rows.size()>points.size()){chosen=key;points=rows;}
    auto result=pearson(points);json decisions=json::object(),excluded=json::object();
    for(const auto& p:products) {
        auto reason=incomplete(p,x,y);
        if(reason.empty() && priceGroup(p,x,y)!=chosen) reason="other_price_source_or_currency";
        decisions[p.at("id").get<std::string>()]=reason.empty()?"Included":reason;
        if(!reason.empty()) excluded[reason]=excluded.value(reason,0)+1;
    }
    result.update({{"x",x},{"y",y},{"selected_products",products.size()},{"excluded_products",products.size()-points.size()},
                   {"cohort",chosen},{"exclusions",excluded},{"decisions",decisions},{"pairs",points}});
    return result;
}
json selectedProducts(const Compiled& model,const json& f) {
    json rows=json::array();for(const auto& p:model.products.items()) if(matches(p.value(),f)) rows.push_back(p.value());return rows;
}
json summary(const Compiled& model,const json& state,const json& products,const json& analysis) {
    std::size_t rawCount=0;for(const auto& s:state.at("sources")) rawCount+=s.at("records").size();
    json availability=json::object();std::size_t missingManufacturer=0,missingCurrency=0;
    for(const auto& p:products){const auto status=p.at("availability").at("status").get<std::string>();availability[status]=availability.value(status,0)+1;if(p.at("manufacturer")=="")++missingManufacturer;if(p.at("currency").is_null())++missingCurrency;}
    std::set<std::string> selectedIds;for(const auto& p:products) selectedIds.insert(p.at("product_id").get<std::string>());
    std::size_t selectedConflicts=0;for(const auto& c:model.conflicts) if(selectedIds.count(c.at("product_id").get<std::string>())) ++selectedConflicts;
    return {{"total_products",model.products.size()},{"selected_products",products.size()},{"source_batches",state.at("sources").size()},
            {"input_rows",rawCount},{"distinct_rows",model.recordCount},{"duplicate_rows_suppressed",rawCount-model.recordCount},
            {"matched_rows",model.matchedRecords},{"unmatched_rows",model.quarantine.size()},{"conflicts",model.conflicts.size()},
            {"selected_conflicts",selectedConflicts},{"missing_manufacturer",missingManufacturer},{"unconfirmed_currency",missingCurrency},
            {"availability",availability},{"r",analysis.at("r")},{"n",analysis.at("n")},{"excluded_products",analysis.at("excluded_products")}};
}
json flattened(const json& p,const json& labels) {
    return {{"product_id",p.at("id")},{"product_name",p.at("name")},{"manufacturer",p.at("manufacturer")},
            {"category",labels.value(p.at("category_id").get<std::string>(),p.at("category_id").get<std::string>())},
            {"category_id",p.at("category_id")},{"price_value",p.at("price_value")},{"shipping_weight_g",p.at("shipping_weight_g")},
            {"availability",p.at("availability").at("status")},{"public_quantity",p.at("availability").at("reported_quantity")},
            {"stock_raw",p.at("availability").at("raw")},{"clock_mhz",metric(p,"clock_mhz")},{"sram_kb",metric(p,"sram_kb")},
            {"flash_mb",metric(p,"flash_mb")},{"captured_at",p.at("captured_at")},{"source_id",p.at("source_id")},
            {"currency",p.at("currency")},{"virtual",p.at("virtual")},{"linked_records",p.at("linked_records")},
            {"quality_flags",p.at("quality_flags")},{"url",p.at("url")}};
}
}

json engineMetrics() {
    return json::array({{{"id","shipping_weight_g"},{"label","Shipping weight (g)"}},{{"id","price_value"},{"label","Catalog price (source units)"}},
                       {{"id","clock_mhz"},{"label","Processor clock (MHz, qualifier retained in evidence)"}},{{"id","sram_kb"},{"label","SRAM (kB as published)"}},
                       {{"id","flash_mb"},{"label","Flash (MB as published)"}},{{"id","public_quantity"},{"label","Public reported quantity"}}});
}

json runEngine(const json& workspace,const json& input) {
    keys(input,{"label","base","mode","filters","analysis","sources","patches"});
    const auto mode=str(input,"mode","observed"),base=str(input,"base","workspace"),label=str(input,"label","Adafruit engine run");
    if(mode!="observed" && mode!="simulation") throw std::invalid_argument("mode must be observed or simulation");
    if(base!="workspace" && base!="uploads_only") throw std::invalid_argument("base must be workspace or uploads_only");
    if(label.empty() || label.size()>140) throw std::invalid_argument("Run label requires 1-140 characters");
    const auto filters=input.value("filters",json::object()),config=input.value("analysis",json::object());
    keys(filters,{"manufacturer","category_id","availability","min_price","max_price"});keys(config,{"x","y"});
    for(const auto* k:{"manufacturer","category_id","availability"}) if(filters.contains(k)) str(filters,k);
    const std::set<std::string> statuses{"in_stock","out_of_stock","unknown","no_longer_stocked","backorder"};
    if(filters.contains("availability") && !statuses.count(str(filters,"availability"))) throw std::invalid_argument("Unknown availability filter");
    for(const auto* k:{"min_price","max_price"}) if(filters.contains(k) && (!isFinite(filters.at(k)) || filters.at(k).get<double>()<0)) throw std::invalid_argument("Price filters require nonnegative numbers");
    if(filters.contains("min_price") && filters.contains("max_price") && filters.at("min_price").get<double>()>filters.at("max_price").get<double>()) throw std::invalid_argument("Minimum price exceeds maximum price");
    const auto x=str(config,"x","shipping_weight_g"),y=str(config,"y","price_value");
    std::set<std::string> allowed;for(const auto& m:engineMetrics()) allowed.insert(m.at("id").get<std::string>());
    if(!allowed.count(x) || !allowed.count(y) || x==y) throw std::invalid_argument("Choose two different supported numeric metrics");
    const auto sources=input.value("sources",json::array()),patches=input.value("patches",json::array());
    if(!sources.is_array() || sources.size()>20) throw std::invalid_argument("Supply up to 20 additional sources");
    if(!patches.is_array() || patches.size()>20000) throw std::invalid_argument("Supply up to 20,000 scenario patches");
    if(!patches.empty() && mode!="simulation") throw std::invalid_argument("Hypothetical patches require simulation mode");
    auto state=workspace;
    if(base=="uploads_only") state["sources"]=json::array();
    const auto baseline=compile(state);
    const auto beforeProducts=selectedProducts(baseline,filters),beforeAnalysis=analyze(beforeProducts,x,y);
    const auto beforeSummary=summary(baseline,state,beforeProducts,beforeAnalysis);
    std::set<std::string> existing;for(const auto& s:state.at("sources")) existing.insert(s.at("id").get<std::string>());
    json supplied=json::array();std::size_t suppliedRows=0;
    for(auto source:sources) {
        if(source.is_object() && source.contains("csv")) {
            if(source.contains("records")) throw std::invalid_argument("Supply CSV or records, not both");
            source["records"]=csvRecords(str(source,"csv"));source.erase("csv");
        }
        source=validateSource(source);
        if(!existing.insert(source.at("id").get<std::string>()).second) throw std::invalid_argument("Source ID is already present. Use a distinct ID per input batch: "+source.at("id").get<std::string>());
        source["_trusted_reference"]=false;source["ingestion_method"]=mode=="simulation"?"simulation_input":"user_upload";
        suppliedRows+=source.at("records").size();if(suppliedRows>50000) throw std::invalid_argument("Additional inputs exceed 50,000 rows per run");
        supplied.push_back(source.at("id"));state["sources"].push_back(source);
    }
    auto model=compile(state);
    std::map<std::string,std::set<std::string>> patched;
    for(const auto& patch:patches) {
        keys(patch,{"product_id","field","value"});
        const auto id=productId(patch.value("product_id",json(nullptr))),field=str(patch,"field");
        if(id.empty() || !model.products.contains(id)) throw std::invalid_argument("Scenario product ID must exist in the loaded model");
        if(field!="price_value" && field!="shipping_weight_g" && field!="public_quantity") throw std::invalid_argument("Scenario fields: price_value, shipping_weight_g, public_quantity");
        if(!patch.contains("value") || !isFinite(patch.at("value")) || patch.at("value").get<double>()<0) throw std::invalid_argument("Scenario values must be finite nonnegative numbers");
        const auto value=patch.at("value");
        if(field=="public_quantity" && (std::floor(value.get<double>())!=value.get<double>() || value.get<double>()>1000000000)) throw std::invalid_argument("Public quantity must be a whole number up to 1 billion");
        if(!patched[id].insert(field).second) throw std::invalid_argument("Duplicate scenario patch for the same product and field");
        if(field=="public_quantity") {model.products[id]["availability"]["reported_quantity"]=value;model.products[id]["availability"]["status"]=value.get<double>()>0?"in_stock":"out_of_stock";}
        else model.products[id][field]=value;
        auto& flags=model.products[id]["quality_flags"];
        const auto fixed=field=="price_value"?"price_missing_or_invalid":field=="shipping_weight_g"?"weight_missing_invalid_or_unit_unknown":"availability_unknown";
        flags.erase(std::remove(flags.begin(),flags.end(),json(fixed)),flags.end());
    }
    const auto selected=selectedProducts(model,filters);auto analysis=analyze(selected,x,y);
    json labels=json::object();for(const auto& s:state.at("sources")) if(s.contains("category_labels")) labels.update(s.at("category_labels"));
    json rows=json::array(),evidence=json::array(),changes=json::array(),sourceRows=json::array(),groups=json::array();
    std::map<std::string,json> manufacturers;
    std::set<std::string> selectedIds;
    for(const auto& p:selected) {
        const auto id=p.at("product_id").get<std::string>(),canonical=p.at("id").get<std::string>();selectedIds.insert(id);
        auto row=flattened(p,labels);row["decision"]=analysis.at("decisions").at(canonical);row["scenario_modified"]=patched.count(id)>0;
        row["scenario_fields"]=patched.count(id)?json(patched.at(id)):json::array();
        row["pair_x"]=row.at("decision")=="Included"?metric(p,x):json(nullptr);row["pair_y"]=row.at("decision")=="Included"?metric(p,y):json(nullptr);
        rows.push_back(row);
        const auto maker=p.at("manufacturer").get<std::string>();if(!manufacturers.count(maker)) manufacturers[maker]=json::array();manufacturers[maker].push_back(p);
        for(const auto& r:model.related.value(id,json::array())) if(r.at("kind")!="catalog") {
            auto entry=r;entry["product_id"]=canonical;entry["simulation"]=mode=="simulation";evidence.push_back(entry);
        }
    }
    // Compare all changed identities, including products that leave the selected filter.
    const std::vector<std::string> fields{"product_name","manufacturer","category_id","price_value","shipping_weight_g","availability","public_quantity","clock_mhz","sram_kb","flash_mb"};
    for(const auto& item:model.products.items()) {
        const auto after=flattened(item.value(),labels);json before=nullptr;
        if(baseline.products.contains(item.key())) before=flattened(baseline.products.at(item.key()),labels);
        for(const auto& field:fields) {
            const auto old=before.is_null()?json(nullptr):before.at(field),value=after.at(field);
            if(old!=value) changes.push_back({{"product_id",after.at("product_id")},{"field",field},{"before",old},{"after",value},
                {"basis",patched.count(item.key()) && (patched.at(item.key()).count(field) || (field=="availability" && patched.at(item.key()).count("public_quantity")))?"scenario_patch":"source_import"},{"in_selected_output",selectedIds.count(item.key())>0}});
        }
    }
    std::stable_sort(rows.begin(),rows.end(),[](const json& a,const json& b){return a.at("scenario_modified").get<bool>()>b.at("scenario_modified").get<bool>();});
    for(const auto& [maker,ps]:manufacturers) {
        const auto a=analyze(ps,x,y);
        if(a.at("n").get<std::size_t>()>=8) groups.push_back({{"manufacturer",maker.empty()?"Unknown manufacturer":maker},{"products",ps.size()},{"n",a.at("n")},{"r",a.at("r")},{"status",a.at("status")},{"cohort",a.at("cohort")}});
    }
    std::stable_sort(groups.begin(),groups.end(),[](const json& a,const json& b){return a.at("n").get<std::size_t>()>b.at("n").get<std::size_t>();});
    for(const auto& s:state.at("sources")) {
        auto meta=s;meta.erase("records");meta.erase("category_labels");meta["record_count"]=s.at("records").size();
        std::size_t unmatched=0;for(const auto& q:model.quarantine) if(q.at("source_id")==s.at("id")) ++unmatched;
        std::set<std::string> unique;for(const auto& r:s.at("records")) unique.insert(r.dump());
        meta["unique_rows"]=unique.size();meta["duplicate_rows"]=s.at("records").size()-unique.size();meta["matched_rows"]=unique.size()-unmatched;meta["unmatched_rows"]=unmatched;
        sourceRows.push_back(meta);
    }
    json selectedConflicts=json::array();for(const auto& c:model.conflicts) if(selectedIds.count(c.at("product_id").get<std::string>())) selectedConflicts.push_back(c);
    auto resultSummary=summary(model,state,selected,analysis);resultSummary["changed_fields"]=changes.size();resultSummary["supplied_rows"]=suppliedRows;resultSummary["scenario_patches"]=patches.size();
    analysis.erase("decisions");analysis.erase("pairs");auto compactBefore=beforeAnalysis;compactBefore.erase("decisions");compactBefore.erase("pairs");
    return {{"schema_version","1.0.0"},{"company","Adafruit"},{"label",label},{"mode",mode},{"base",base},{"base_revision",workspace.value("revision",0)},
            {"request",input},{"summary",resultSummary},{"baseline",beforeSummary},{"baseline_analysis",compactBefore},{"analysis",analysis},
            {"products",rows},{"changes",changes},{"evidence",evidence},{"sources",sourceRows},{"supplied_sources",supplied},
            {"manufacturer_correlations",groups},{"conflicts",selectedConflicts},{"quarantine",model.quarantine},
            {"scope","Public catalog and selected technical evidence. Additional uploads are user-supplied. Simulation runs contain hypothetical values."},
            {"interpretation","Exploratory cross-sectional association. Product mix, packaging and outliers affect it. It does not establish causation, demand or profitability."}};
}

std::string tableCsv(const json& rows) {
    if(!rows.is_array()) throw std::invalid_argument("CSV rows must be an array");
    if(rows.empty()) return "";
    std::set<std::string> names;for(const auto& row:rows) for(const auto& item:row.items()) names.insert(item.key());
    auto quote=[](std::string value,bool text){
        // Prevent spreadsheet formula execution for untrusted textual source cells.
        auto first=value.find_first_not_of(" \t\r\n");
        if(text && first!=std::string::npos && (value[first]=='=' || value[first]=='+' || value[first]=='-' || value[first]=='@')) value="'"+value;
        std::string out="\"";for(char c:value){if(c=='\"')out+='\"';out+=c;}return out+'\"';
    };
    std::ostringstream out;bool first=true;
    for(const auto& name:names){if(!first)out<<',';out<<quote(name,true);first=false;}out<<"\r\n";
    for(const auto& row:rows){first=true;for(const auto& name:names){if(!first)out<<',';const auto value=row.value(name,json(nullptr));out<<quote(value.is_null()?"":value.is_string()?value.get<std::string>():value.dump(),!value.is_number());first=false;}out<<"\r\n";}
    return out.str();
}
}
