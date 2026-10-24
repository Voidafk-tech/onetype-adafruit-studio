#pragma once
#include "pipeline.hpp"

namespace onetype {
// Pure, isolated processing: neither the baseline nor the request is mutated.
json runEngine(const json& workspace, const json& request);
json engineMetrics();
std::string tableCsv(const json& rows);
}
