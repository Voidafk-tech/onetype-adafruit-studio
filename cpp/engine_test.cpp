// Synthetic fixtures test behavior. They are not Adafruit company records.
#include "engine.hpp"
#include <cassert>
#include <cmath>
#include <iostream>
using namespace onetype;
template<class F>void rejects(F f){bool ok=false;try{f();}catch(const std::exception&){ok=true;}assert(ok);}
json source(std::string id,std::string kind,json records){return {{"id",id},{"kind",kind},{"label","Synthetic engine test"},{"captured_at","2026-10-24"},{"records",records}};}
int main(){
    json catalog=json::array();for(int i=1;i<=9;++i)catalog.push_back({{"product_id",std::to_string(i)},{"product_name","Fixture "+std::to_string(i)},{"product_price",std::to_string(2*i)},{"product_shipping_weight",std::to_string(i)},{"product_manufacturer","Test Maker"},{"product_stock",i==1?"-3":"0"},{"product_master_category","TEST"},{"products_virtual",i==9?"1":"0"}});
    const json workspace={{"revision",42},{"sources",json::array({source("CAT","catalog",catalog)})}};
    const auto unchanged=workspace;
    const auto real=runEngine(workspace,json::object());assert(real.at("summary").at("n")==8);assert(real.at("analysis").at("r")==1);assert(real.at("summary").at("excluded_products")==1);assert(real.at("products")[0].at("public_quantity").is_null());
    auto scenario=json{{"mode","simulation"},{"patches",json::array({{{"product_id","ADA1"},{"field","price_value"},{"value",100}},{{"product_id","1"},{"field","public_quantity"},{"value",0}}})}};
    const auto modified=runEngine(workspace,scenario);assert(modified.at("baseline").at("r")==1);assert(modified.at("analysis").at("r").get<double>()<0);assert(workspace==unchanged);assert(modified.at("summary").at("scenario_patches")==2);assert(modified.at("products")[0].at("public_quantity")==0);assert(modified.at("products")[0].at("availability")=="out_of_stock");
    scenario["mode"]="observed";rejects([&]{runEngine(workspace,scenario);});scenario["mode"]="simulation";
    scenario["patches"][0]["product_id"]="99999";rejects([&]{runEngine(workspace,scenario);});scenario["patches"][0]["product_id"]="1";
    scenario["patches"][0]["value"]=-1;rejects([&]{runEngine(workspace,scenario);});scenario["patches"][0]["value"]=0;
    const auto zero=runEngine(workspace,scenario);assert(zero.at("products")[0].at("price_value")==0 && zero.at("summary").at("n")==8);
    scenario["patches"].push_back(scenario["patches"][0]);rejects([&]{runEngine(workspace,scenario);});
    const auto csv=source("CSV","specifications",json::array());auto upload=csv;upload.erase("records");upload["csv"]="record_id,product_id,property,value,unit\na,ADA1,sram,64,kB\na,ADA1,sram,64,kB\nb,99999,sram,64,kB\nc,2,sram,128,kB\n";upload["_trusted_reference"]=true;
    const auto linked=runEngine(workspace,{{"sources",json::array({upload})}});assert(linked.at("summary").at("duplicate_rows_suppressed")==1);assert(linked.at("quarantine").size()==1);assert(linked.at("evidence").size()==2);assert(linked.at("sources").back().at("_trusted_reference")==false);
    const auto sparse=runEngine(workspace,{{"sources",json::array({upload})},{"analysis",{{"x","sram_kb"},{"y","price_value"}}}});assert(sparse.at("analysis").at("n")==2);assert(sparse.at("analysis").at("r").is_null());assert(sparse.at("analysis").at("status")=="insufficient_pairs");
    const auto f=runEngine(workspace,{{"filters",{{"max_price",0}}}});assert(f.at("products").empty() && f.at("analysis").at("r").is_null());
    rejects([&]{runEngine(workspace,{{"filters",{{"min_price",10},{"max_price",1}}}});});rejects([&]{runEngine(workspace,{{"analysis",{{"x","price_value"},{"y","price_value"}}}});});
    rejects([&]{runEngine(workspace,{{"sources",json::array({source("CAT","catalog",catalog)})}});});
    const auto imported=source("NEW_CAT","catalog",json::array({catalog[0]}));auto latest=imported;latest["captured_at"]="2026-10-25";
    const auto split=runEngine(workspace,{{"sources",json::array({latest})}});assert(split.at("analysis").at("n")==7);assert(split.at("analysis").at("exclusions").at("other_price_source_or_currency")==1);
    const auto own=runEngine(workspace,{{"base","uploads_only"},{"sources",json::array({source("OWN","catalog",catalog)})}});assert(own.at("baseline").at("total_products")==0);assert(own.at("summary").at("total_products")==9);
    const auto nameOnly=source("NAME","documents",json::array({{{"product_name","Fixture 1"},{"title","Test"},{"url","https://example.com/test"}}}));const auto names=runEngine(workspace,{{"sources",json::array({nameOnly})}});assert(names.at("quarantine").size()==1);assert(names.at("quarantine")[0].at("candidate_ids")[0]=="1");
    assert(tableCsv(json::array({{{"value"," =HYPERLINK(\"bad\")"},{"number",-1}}})).find("' =HYPERLINK")!=std::string::npos);
    assert(workspace==unchanged);
    std::cout<<"PASS: isolated runs, changed outputs, zero versus unknown, scenario validation, CSV parsing, duplicate suppression, quarantine, authority stripping, sparse metrics, filters, currency/source separation, uploads-only base and CSV formula protection\n";
}
