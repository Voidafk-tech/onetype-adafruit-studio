#pragma once
#include <nlohmann/json.hpp>
#include <filesystem>
#include <mutex>
#include <chrono>
#include <map>
#include <string>
#include <stdexcept>

namespace onetype {
using json = nlohmann::json;
// Exact retailer identity, not a fuzzy title match. Returns an empty string when unknown.
std::string productId(const json& value);
json cleanCatalog(const json& row);
json pearson(const json& points);
struct Compiled {
    json products = json::object(), related = json::object();
    json quarantine = json::array(), conflicts = json::array();
    std::size_t recordCount = 0, matchedRecords = 0;
};
Compiled compile(const json& state);
json validateSource(json source);
json csvRecords(const std::string& csv);
struct Conflict : std::runtime_error {using std::runtime_error::runtime_error;};
class Pipeline {
    std::filesystem::path file_;
    mutable std::mutex mutex_;
    json state_;
    Compiled model_;
    std::chrono::steady_clock::time_point lastFetch_{};
    bool fetching_ = false;
    void save(const json& state) const;
public:
    explicit Pipeline(const std::filesystem::path& file);
    json overview() const;
    json products(const std::string& q, const std::string& manufacturer, const std::string& category, int page) const;
    json product(const std::string& id) const;
    json patterns(const std::string& manufacturer, const std::string& category) const;
    json preview(const json& source) const;
    json import(const json& source, int expectedRevision);
    json refresh();
    json exportState() const;
};
}
