// Fictional fixtures exercise the pipeline; they are not company operating records.
#include "pipeline.hpp"
#include <cassert>
#include <cmath>
#include <fstream>
#include <iostream>
#include <unistd.h>
using namespace onetype;
template<class F> void rejects(F action) {bool rejected=false;try{action();}catch(const std::exception&){rejected=true;}assert(rejected);}
json source(const std::string& id,const std::string& kind,const json& rows) {
    return {{"id",id},{"label","Fictional test fixture"},{"kind",kind},{"captured_at","2026-10-24"},{"records",rows}};
}
json catalogRow(const std::string& id) {return {{"product_id",id},{"product_name","Test board "+id},{"product_price","$6.25"},{"shipping_weight","0.0041"},{"weight_unit","kg"},{"product_stock","in stock"}};}
int main() {
    assert(productId("ADA6006")=="6006"); assert(productId("adafruit:006006")=="6006");
    assert(productId("https://www.adafruit.com/product/6006")=="6006");
    assert(productId("6006.0").empty()); assert(productId("Pico 2").empty()); assert(productId("https://other.example/product/6006").empty());
    auto row=catalogRow("6006"),clean=cleanCatalog(row);
    assert(std::abs(clean.at("shipping_weight_g").get<double>()-4.1)<1e-9);
    assert(clean.at("price_value")==6.25 && clean.at("currency").is_null());
    assert(clean.at("availability").at("reported_quantity").is_null());
    row["product_stock"]="-3";assert(cleanCatalog(row).at("availability").at("status")=="unknown");
    row["product_stock"]="0";assert(cleanCatalog(row).at("availability").at("reported_quantity")==0);
    row["product_stock"]="1 in stock";assert(cleanCatalog(row).at("availability").at("reported_quantity")==1);
    row["product_price"]="junk";assert(cleanCatalog(row).at("price_value").is_null());
    row["product_price"]="-9";assert(cleanCatalog(row).at("price_value").is_null());
    row["product_price"]="6,25";assert(cleanCatalog(row).at("price_value").is_null());
    row["product_price"]="1,234.50";assert(cleanCatalog(row).at("price_value")==1234.5);
    row["product_url"]="https://www.adafruit.com/product/4864";rejects([&]{cleanCatalog(row);});
    auto catalog=source("CAT","catalog",json::array({catalogRow("6006"),catalogRow("4864")}));
    auto reference=source("REF","specifications",json::array({{{"product_id","6006"},{"property","sram"},{"value","520"},{"unit","kB"}}}));reference["_trusted_reference"]=true;
    auto claim=source("CLAIM","specifications",json::array({{{"product_id","ADA6006"},{"property","sram"},{"value","512"},{"unit","KB"}}}));
    json state={{"revision",1},{"sources",json::array({catalog,reference,claim})}};
    auto compiled=compile(state);assert(compiled.products.size()==2 && compiled.conflicts.size()==1);
    assert(compiled.conflicts[0].at("selected").at("value")==520);
    auto clock=source("CLOCK","specifications",json::array({{{"product_id","6006"},{"property","clock"},{"value",150},{"unit","MHz"},{"qualifier","up_to"}}}));
    auto clockState=state;clockState["sources"].push_back(clock);assert(compile(clockState).products.at("6006").at("specifications")[0].at("selected").at("qualifier")=="up_to");
    auto docs=source("DOCS","documents",json::array({{{"product_id","ADA6006"},{"title","Test doc"},{"url","https://example.com/doc"}},{{"product_id","999999"},{"title","Unknown ID"},{"url","https://example.com/missing"}},{{"product_name","Test board 4864"},{"title","Name only"},{"url","https://example.com/name"}}}));
    auto expanded=state;expanded["sources"].push_back(docs);auto links=compile(expanded);
    assert(links.quarantine.size()==2);assert(links.quarantine[1].at("candidate_ids")[0]=="4864");
    auto duplicates=catalog;duplicates["records"].push_back(catalog["records"][0]);
    auto duplicateState=state;duplicateState["sources"][0]=duplicates;
    assert(compile(duplicateState).recordCount==compiled.recordCount);
    duplicates["records"][2]["product_price"]="99";rejects([&]{validateSource(duplicates);});
    auto badDate=catalog;badDate["captured_at"]="2026-02-30";rejects([&]{validateSource(badDate);});
    auto badTime=catalog;badTime["captured_at"]="2026-10-24T25:00:00Z";rejects([&]{validateSource(badTime);});
    const auto csv=csvRecords("product_id,title,quantity\r\nADA6006,\"A, quoted \"\"title\"\"\",12\r\n");
    assert(csv[0].at("title")=="A, quoted \"title\"" && csv[0].at("quantity")=="12");
    assert(csvRecords("product_id,note\n6006,\"two\nlines\"\n")[0].at("note")=="two\nlines");
    rejects([&]{csvRecords("id,id\n1,2\n");});rejects([&]{csvRecords("id,a\n1\n");});rejects([&]{csvRecords("id\n\"open");});
    json points=json::array();for(int i=1;i<=8;++i)points.push_back({{"x",i},{"y",2*i}});
    assert(std::abs(pearson(points).at("r").get<double>()-1)<1e-12);
    for(auto& p:points)p["y"]=-p["x"].get<int>();assert(pearson(points).at("r")==-1);
    for(auto& p:points)p["x"]=1;assert(pearson(points).at("r").is_null());points.erase(0);assert(pearson(points).at("status")=="insufficient_pairs");
    const auto folder=std::filesystem::temp_directory_path()/("onetype-test-"+std::to_string(getpid()));std::filesystem::create_directory(folder);
    const auto file=folder/"workspace.json";{std::ofstream out(file);out<<state;}
    {
        Pipeline pipeline(file);assert(pipeline.overview().at("products")==2);
        const auto preview=pipeline.preview(docs);assert(preview.at("stats").at("matched")==1 && preview.at("stats").at("unmatched")==2);
        assert(pipeline.exportState().at("revision")==1);
        pipeline.import(docs,1);assert(pipeline.exportState().at("revision")==2);
        assert(pipeline.import(docs,2).at("duplicate")==true && pipeline.exportState().at("revision")==2);
        rejects([&]{pipeline.import(source("NEW","documents",docs["records"]),1);});
        auto invalid=source("BAD","inventory",json::array({{{"product_id","6006"},{"warehouse_id","TEST"},{"quantity",-1}}}));
        const auto before=pipeline.exportState();rejects([&]{pipeline.import(invalid,2);});assert(before==pipeline.exportState());
        auto spoof=source("SPOOF","specifications",json::array({{{"product_id","6006"},{"property","sram"},{"value",700},{"unit","kB"}}}));spoof["_trusted_reference"]=true;
        pipeline.import(spoof,2);assert(pipeline.product("6006").at("product").at("specifications")[0].at("selected").at("value")==520);
        const auto saved=pipeline.exportState();assert(saved["sources"].back().at("_trusted_reference")==false);
        auto idReuse=docs;idReuse["label"]="Different content";rejects([&]{pipeline.preview(idReuse);});
        auto inventory=source("WAREHOUSE","inventory",json::array({{{"product_id","ADA6006"},{"warehouse_id","TEST"},{"quantity","12"}}}));
        pipeline.import(inventory,3);assert(pipeline.product("6006").at("records").back().at("normalized").at("quantity")==12);
        auto duplicateDocs=source("DUPLICATE_ROWS","documents",json::array({docs["records"][0],docs["records"][0]}));
        assert(pipeline.preview(duplicateDocs).at("stats").at("duplicate_records")==1);
    }
    {Pipeline restored(file);assert(restored.overview().at("revision")==4);assert(restored.product("6006").at("product").at("availability").at("reported_quantity").is_null());}
    std::filesystem::remove_all(folder);
    std::cout<<"PASS: identity, types, units, nulls, conflict retention, quarantine, duplicate handling, atomic rejection, revision checks, authority, persistence and Pearson edge cases\n";
}
