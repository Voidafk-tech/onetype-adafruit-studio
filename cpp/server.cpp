// OneType's connected model. Read main() last: it connects these functions to HTTP.
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include "pipeline.hpp"
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>

using json = nlohmann::json;
namespace fs = std::filesystem;

json readJson(const fs::path& path) {
    std::ifstream file(path);
    if (!file) throw std::runtime_error("Cannot open " + path.string());
    return json::parse(file);
}
std::string lower(std::string text) {
    for (auto& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}
std::string label(const json& row) {
    for (const auto* field : {"name", "title", "product_name", "category", "property", "id"})
        if (row.contains(field) && row[field].is_string()) return row[field].get<std::string>();
    return "Unnamed record";
}
std::string stringField(const json& row, const std::string& key) {
    // Unknown foreign keys are null in the model, rather than empty strings.
    return row.contains(key) && row[key].is_string() ? row[key].get<std::string>() : "";
}

class Ontology {
    json model_, raw_, graph_;
    std::map<std::string, json> records_;
    std::map<std::string, std::string> types_;

    void index(const json& rows, const std::string& type) {
        for (const auto& row : rows) {
            const auto id = row.at("id").get<std::string>();
            if (!records_.emplace(id, row).second) throw std::runtime_error("Duplicate ID: " + id);
            types_[id] = type;
        }
    }
    void validateReferences(const json& node) const {
        if (node.is_array()) {
            for (const auto& item : node) validateReferences(item);
        } else if (node.is_object()) {
            for (const auto& item : node.items()) {
                const auto& key = item.key();
                const auto& value = item.value();
                const bool reference = key != "dataset_id" &&
                    ((key.size() >= 3 && key.substr(key.size()-3) == "_id") ||
                     (key.size() >= 4 && key.substr(key.size()-4) == "_ids"));
                if (reference && !value.is_null()) {
                    const json refs = value.is_array() ? value : json::array({value});
                    for (const auto& ref : refs)
                        if (!ref.is_string() || !records_.count(ref.get<std::string>()))
                            throw std::runtime_error("Broken reference in " + key + ": " + ref.dump());
                }
                validateReferences(value);
            }
        }
    }
    json shortRecord(const std::string& id) const {
        const auto& row = records_.at(id);
        return {{"id", id}, {"type", types_.at(id)}, {"name", label(row)},
                {"status", row.value("mapping_status", row.value("status", std::string()))}};
    }

public:
    explicit Ontology(const fs::path& directory)
        : model_(readJson(directory / "clean_model.json")),
          raw_(readJson(directory / "raw_records.json")),
          graph_(readJson(directory / "relationships.json")) {
        for (const auto& table : model_.items()) if (table.value().is_array()) index(table.value(), table.key());
        index(raw_.at("sources"), "sources");
        index(raw_.at("records"), "raw_records");
        index(graph_.at("relationships"), "relationships");
        // Reject incomplete imports at startup instead of showing disconnected facts.
        validateReferences(model_); validateReferences(raw_); validateReferences(graph_);
    }

    // This is a real join: group listing records by variant, using accepted mappings only.
    json summary() const {
        std::map<std::string, std::set<std::string>> accepted, candidates;
        for (const auto& listing : model_.at("listings")) {
            const auto variant = listing.at("variant_id").get<std::string>();
            const auto company = listing.at("company_id").get<std::string>();
            candidates[variant].insert(company);
            if (listing.at("mapping_status") == "accepted") accepted[variant].insert(company);
        }
        json shared = json::array(), proposed = json::array();
        for (const auto& [id, companies] : candidates) {
            if (accepted[id].size() > 1) shared.push_back(shortRecord(id));
            else if (companies.size() > 1) proposed.push_back(shortRecord(id));
        }
        int open = 0;
        for (const auto& issue : model_.at("quality_issues")) if (issue.at("status") == "open") ++open;
        return {{"dataset_id", model_.at("dataset_id")}, {"observed_on", model_.at("observed_on")},
                {"listings", model_.at("listings").size()}, {"sources", raw_.at("sources").size()},
                {"relationships", graph_.at("relationships").size()}, {"open_issues", open},
                {"shared_designs", shared}, {"candidate_designs", proposed},
                {"backend", "C++17"}, {"live", false}};
    }

    json search(const std::string& type, const std::string& query) const {
        json results = json::array();
        const auto needle = lower(query);
        for (const auto& [id, row] : records_) {
            if (types_.at(id) == "relationships") continue;
            if (type != "all" && types_.at(id) != type) continue;
            if (!needle.empty() && lower(row.dump()).find(needle) == std::string::npos) continue;
            results.push_back(shortRecord(id));
        }
        return results;
    }

    json graph(bool includeProposed) const {
        json nodes = json::array(), edges = json::array();
        std::set<std::string> ids;
        for (const auto& edge : graph_.at("relationships")) {
            if (!includeProposed && edge.value("mapping_status", std::string()) == "proposed") continue;
            edges.push_back(edge);
            ids.insert(edge.at("from_id").get<std::string>());
            ids.insert(edge.at("to_id").get<std::string>());
        }
        for (const auto& id : ids) nodes.push_back(shortRecord(id));
        return {{"nodes", nodes}, {"edges", edges}};
    }

    // Follow IDs to related records and their original evidence, without changing source claims.
    json inspect(const std::string& id) const {
        if (!records_.count(id)) throw std::out_of_range("Unknown entity ID: " + id);
        const auto& record = records_.at(id);
        json result = {{"record", record}, {"type", types_.at(id)}};
        for (const auto* key : {"relationships", "related_listings", "prices", "availability", "claims",
                               "resolved_specifications", "issues", "sources", "raw_records", "affected_records"})
            result[key] = json::array();
        std::set<std::string> selected{id}, sourceIds, rawIds;
        auto collectEvidence = [&](const json& row) {
            if (row.contains("source_ids")) for (const auto& s : row["source_ids"]) sourceIds.insert(s.get<std::string>());
            if (row.contains("source_id")) sourceIds.insert(row.at("source_id").get<std::string>());
            if (row.contains("raw_record_id") && row["raw_record_id"].is_string()) rawIds.insert(row["raw_record_id"].get<std::string>());
        };
        collectEvidence(record);
        if (types_.at(id) == "sources") sourceIds.insert(id);
        if (types_.at(id) == "raw_records") rawIds.insert(id);

        for (const auto& edge : graph_.at("relationships")) {
            if (edge.at("from_id") != id && edge.at("to_id") != id) continue;
            auto view = edge;
            view["from"] = shortRecord(edge.at("from_id"));
            view["to"] = shortRecord(edge.at("to_id"));
            result["relationships"].push_back(view);
            collectEvidence(edge);
        }
        for (const auto& listing : model_.at("listings")) {
            if (listing.at("variant_id") != id) continue;
            auto view = listing;
            const auto listingId = listing.at("id").get<std::string>();
            selected.insert(listingId);
            view["company_name"] = label(records_.at(listing.at("company_id")));
            view["availability"] = json::array(); view["prices"] = json::array();
            for (const auto& a : model_.at("availability_observations")) if (a.at("listing_id") == listingId) view["availability"].push_back(a);
            for (const auto& p : model_.at("price_observations")) if (p.at("listing_id") == listingId) view["prices"].push_back(p);
            result["related_listings"].push_back(view);
            collectEvidence(listing);
        }
        for (const auto& [table, destination] : std::map<std::string,std::string>{
                 {"price_observations","prices"}, {"availability_observations","availability"},
                 {"specification_claims","claims"}, {"resolved_specifications","resolved_specifications"}}) {
            for (const auto& row : model_.at(table)) {
                const bool belongs = stringField(row, "variant_id") == id || stringField(row, "listing_id") == id;
                if (!belongs) continue;
                result[destination].push_back(row);
                selected.insert(row.at("id").get<std::string>());
                collectEvidence(row);
            }
        }
        for (const auto& issue : model_.at("quality_issues")) {
            bool relevant = issue.at("id") == id;
            for (const auto& affected : issue.at("affected_ids")) if (selected.count(affected.get<std::string>())) relevant = true;
            if (relevant) {result["issues"].push_back(issue); collectEvidence(issue);}
        }
        if (record.contains("affected_ids")) for (const auto& affected : record.at("affected_ids")) result["affected_records"].push_back(shortRecord(affected));
        for (const auto& source : raw_.at("sources")) if (sourceIds.count(source.at("id").get<std::string>())) result["sources"].push_back(source);
        for (const auto& row : raw_.at("records"))
            if (rawIds.count(row.at("id").get<std::string>()) || sourceIds.count(row.at("source_id").get<std::string>())) result["raw_records"].push_back(row);
        return result;
    }
};

int main(int argc, char** argv) {
    try {
        int port = 4180;
        if (argc == 3 && std::string(argv[1]) == "--port") {
            std::size_t end = 0;
            port = std::stoi(argv[2], &end);
            if (end != std::string(argv[2]).size() || port < 1024 || port > 65535) throw std::invalid_argument("Invalid port");
        } else if (argc != 1) throw std::invalid_argument("Usage: run.sh [--port 4180]");
        const Ontology model("data");
        if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) throw std::runtime_error("Cannot initialize HTTPS");
        onetype::Pipeline pipeline("data/workspace.json");
        httplib::Server server;
        server.set_payload_max_length(20*1024*1024);
        server.set_default_headers({{"Cache-Control", "no-store"}, {"X-Content-Type-Options", "nosniff"}});
        auto reply = [](httplib::Response& res, const json& value) {res.set_content(value.dump(), "application/json");};
        server.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {reply(res, {{"ok",true}, {"backend","C++17"}, {"live",false}});});
        server.Get("/api/summary", [&](const httplib::Request&, httplib::Response& res) {reply(res, model.summary());});
        server.Get("/api/entities", [&](const httplib::Request& req, httplib::Response& res) {
            reply(res, model.search(req.has_param("type") ? req.get_param_value("type") : "all", req.get_param_value("q")));
        });
        server.Get("/api/entity", [&](const httplib::Request& req, httplib::Response& res) {
            try {reply(res, model.inspect(req.get_param_value("id")));}
            catch (const std::out_of_range& e) {res.status = 404; reply(res, {{"error",e.what()}});}
        });
        server.Get("/api/graph", [&](const httplib::Request& req, httplib::Response& res) {reply(res, model.graph(req.get_param_value("proposed") == "1"));});
        auto allowedWrite = [port,&reply](const httplib::Request& req,httplib::Response& res) {
            const auto origin = req.get_header_value("Origin");
            if (req.get_header_value("Sec-Fetch-Site") == "cross-site" ||
                (!origin.empty() && origin != "http://127.0.0.1:"+std::to_string(port) && origin != "http://localhost:"+std::to_string(port))) {
                res.status = 403; reply(res,{{"error","Use the interface served by this local application"}}); return false;
            }
            return true;
        };
        server.Get("/api/workspace",[&](const httplib::Request&,httplib::Response& res){reply(res,pipeline.overview());});
        server.Get("/api/products",[&](const httplib::Request& req,httplib::Response& res){
            try {
                int page = 0;
                if (req.has_param("page")) {
                    std::size_t end = 0; const auto raw = req.get_param_value("page"); page = std::stoi(raw,&end);
                    if (end != raw.size() || page < 0 || page > 100000) throw std::invalid_argument("Invalid page number");
                }
                reply(res,pipeline.products(req.get_param_value("q"),req.get_param_value("manufacturer"),req.get_param_value("category"),page));
            } catch (const std::exception& e) {res.status = 400; reply(res,{{"error",e.what()}});}
        });
        server.Get("/api/product",[&](const httplib::Request& req,httplib::Response& res){
            try {reply(res,pipeline.product(req.get_param_value("id")));}
            catch (const std::out_of_range& e) {res.status = 404; reply(res,{{"error",e.what()}});}
        });
        server.Get("/api/patterns",[&](const httplib::Request& req,httplib::Response& res){reply(res,pipeline.patterns(req.get_param_value("manufacturer"),req.get_param_value("category")));});
        server.Post("/api/import/preview",[&](const httplib::Request& req,httplib::Response& res){
            if (!allowedWrite(req,res)) return;
            try {reply(res,pipeline.preview(json::parse(req.body).at("source")));}
            catch (const onetype::Conflict& e) {res.status = 409; reply(res,{{"error",e.what()}});}
            catch (const std::exception& e) {res.status = 400; reply(res,{{"error",e.what()}});}
        });
        server.Post("/api/import/csv-preview",[&](const httplib::Request& req,httplib::Response& res){
            if (!allowedWrite(req,res)) return;
            try {
                const auto body = json::parse(req.body); auto source = body.at("source");
                source["records"] = onetype::csvRecords(body.at("csv").get<std::string>());
                reply(res,{{"source",source},{"preview",pipeline.preview(source)}});
            } catch (const onetype::Conflict& e) {res.status = 409; reply(res,{{"error",e.what()}});}
              catch (const std::exception& e) {res.status = 400; reply(res,{{"error",e.what()}});}
        });
        server.Post("/api/import",[&](const httplib::Request& req,httplib::Response& res){
            if (!allowedWrite(req,res)) return;
            try {
                const auto body = json::parse(req.body);
                if (!body.contains("expected_revision") || !body.at("expected_revision").is_number_integer() || body.at("expected_revision").get<double>() < 0 || body.at("expected_revision").get<double>() > 2147483646) throw std::invalid_argument("Supply the integer expected_revision from preview");
                reply(res,pipeline.import(body.at("source"),body.at("expected_revision").get<int>()));
            } catch (const onetype::Conflict& e) {res.status = 409; reply(res,{{"error",e.what()}});}
              catch (const std::exception& e) {res.status = 400; reply(res,{{"error",e.what()}});}
        });
        server.Post("/api/refresh-catalog",[&](const httplib::Request& req,httplib::Response& res){
            if (!allowedWrite(req,res)) return;
            try {reply(res,pipeline.refresh());}
            catch (const onetype::Conflict& e) {res.status = 409; reply(res,{{"error",e.what()}});}
            catch (const std::exception& e) {res.status = 502; reply(res,{{"error",e.what()}});}
        });
        server.Get("/api/workspace/export",[&](const httplib::Request&,httplib::Response& res){
            res.set_header("Content-Disposition","attachment; filename=adafruit-workspace.json"); reply(res,pipeline.exportState());
        });
        if (!server.set_mount_point("/", "dist")) throw std::runtime_error("Missing dist directory");
        server.set_exception_handler([&](const httplib::Request&, httplib::Response& res, std::exception_ptr error) {
            try {if (error) std::rethrow_exception(error);}
            catch (const std::exception& e) {std::cerr << "Query error: " << e.what() << '\n';}
            catch (...) {std::cerr << "Unknown query error\n";}
            res.status = 500; reply(res, {{"error","The model query failed. Check the server terminal."}});
        });
        std::cout << "OneType Adafruit workspace: http://127.0.0.1:" << port << "\n"
                  << "C++17 backend | persistent source imports | Ctrl+C to stop" << std::endl;
        if (!server.listen("127.0.0.1", port)) throw std::runtime_error("Cannot bind port; try sh run.sh --port 4181");
    } catch (const std::exception& e) {std::cerr << e.what() << '\n'; return 1;}
}
