#include "engine.hpp"
#include <httplib.h>
#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <random>
#include <regex>
#include <spawn.h>
#include <sstream>
#include <thread>
#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
namespace fs=std::filesystem;
using onetype::json;

namespace {
std::string bytes(const fs::path& path) {std::ifstream in(path,std::ios::binary);if(!in)throw std::out_of_range("Run or output file was not found");return {std::istreambuf_iterator<char>(in),std::istreambuf_iterator<char>()};}
json read(const fs::path& path){return json::parse(bytes(path));}
void write(const fs::path& path,const std::string& value){std::ofstream out(path,std::ios::binary);if(!out)throw std::runtime_error("Cannot create run output");out<<value;out.flush();if(!out)throw std::runtime_error("Cannot finish run output");}
std::string stamp(bool id=false){const auto now=std::time(nullptr);std::tm utc{};gmtime_r(&now,&utc);std::ostringstream out;out<<std::put_time(&utc,id?"%Y%m%dT%H%M%SZ":"%Y-%m-%dT%H:%M:%SZ");return out.str();}
std::string token(){std::random_device r;std::ostringstream s;s<<stamp(true)<<'-'<<std::hex<<std::setw(8)<<std::setfill('0')<<r();return s.str();}
fs::path directory(const fs::path& root,const std::string& id){if(!std::regex_match(id,std::regex("[A-Za-z0-9_-]{1,80}")))throw std::invalid_argument("Invalid run identifier");return root/id;}
json publicResult(json result){for(const auto* name:{"products","evidence","changes","quarantine"}){const auto count=result.at(name).size();const std::size_t limit=std::string(name)=="changes"?100:50;result[std::string(name)+"_total"]=count;if(count>limit)result[name].erase(result[name].begin()+limit,result[name].end());}return result;}
json saveRun(const json& workspace,const json& request,const fs::path& root){
    auto result=onetype::runEngine(workspace,request);const auto id=token();result["run_id"]=id;result["created_at"]=stamp();
    fs::create_directories(root);const auto draft=root/(".draft-"+id),dest=directory(root,id);fs::create_directory(draft);
    try {
        write(draft/"inputs.json",json{{"workspace",workspace},{"request",request}}.dump());write(draft/"result.json",result.dump());
        for(const auto& pair:std::vector<std::pair<std::string,std::string>>{{"products","products"},{"changes","changes"},{"evidence","evidence"},{"sources","sources"},{"quarantine","unmatched"},{"manufacturer_correlations","correlations"}}) write(draft/(pair.second+".csv"),onetype::tableCsv(result.at(pair.first)));
        const json meta={{"run_id",id},{"label",result.at("label")},{"mode",result.at("mode")},{"created_at",result.at("created_at")},{"summary",result.at("summary")},{"base_revision",result.at("base_revision")}};
        write(draft/"meta.json",meta.dump());fs::rename(draft,dest);return result;
    } catch(...){fs::remove_all(draft);throw;}
}
std::string nodePath(){if(const char* p=std::getenv("ONETYPE_NODE"))return p;const char* home=std::getenv("HOME");if(home){const auto bundled=fs::path(home)/".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";if(fs::exists(bundled))return bundled.string();}return "node";}
void excel(const fs::path& run){
    const auto output=run/"workbook.xlsx";if(fs::exists(output))return;
    const auto node=nodePath(),script=fs::absolute("scripts/export-engine.mjs").string(),input=fs::absolute(run/"result.json").string(),dest=fs::absolute(output).string(),log=fs::absolute(run/"export.log").string();
    std::vector<char*> argv{const_cast<char*>(node.c_str()),const_cast<char*>(script.c_str()),const_cast<char*>(input.c_str()),const_cast<char*>(dest.c_str()),nullptr};
    posix_spawn_file_actions_t actions;posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions,STDOUT_FILENO,log.c_str(),O_CREAT|O_WRONLY|O_TRUNC,0600);posix_spawn_file_actions_adddup2(&actions,STDOUT_FILENO,STDERR_FILENO);
    pid_t pid;const int error=posix_spawnp(&pid,node.c_str(),&actions,nullptr,argv.data(),environ);posix_spawn_file_actions_destroy(&actions);
    if(error)throw std::runtime_error("Excel requires Node.js and the configured spreadsheet runtime. CSV and JSON outputs are available.");
    int status=0;const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(180);
    while(true){const auto done=waitpid(pid,&status,WNOHANG);if(done==pid)break;if(done<0)throw std::runtime_error("Cannot read Excel export status");if(std::chrono::steady_clock::now()>deadline){kill(pid,SIGTERM);waitpid(pid,&status,0);throw std::runtime_error("Excel export timed out. CSV and JSON outputs are available.");}std::this_thread::sleep_for(std::chrono::milliseconds(100));}
    if(!WIFEXITED(status)||WEXITSTATUS(status)!=0||!fs::exists(output))throw std::runtime_error("Excel export failed. CSV and JSON are available. Details are saved in this run's export.log.");
}
}

int main(int argc,char** argv){
    try {
        int port=4181;fs::path workspace="data/workspace.json",runs="runs";std::string requestFile,replayFile;
        for(int i=1;i<argc;i+=2){if(i+1>=argc)throw std::invalid_argument("Options need a value");const std::string key=argv[i],value=argv[i+1];if(key=="--port"){std::size_t used=0;port=std::stoi(value,&used);if(used!=value.size()||port<1024||port>65535)throw std::invalid_argument("Invalid port");}else if(key=="--workspace")workspace=value;else if(key=="--runs")runs=value;else if(key=="--request")requestFile=value;else if(key=="--replay")replayFile=value;else throw std::invalid_argument("Options: --port, --workspace, --runs, --request, --replay");}
        if(!replayFile.empty()){if(!requestFile.empty())throw std::invalid_argument("Choose --request or --replay");const auto saved=read(replayFile);const auto result=saveRun(saved.at("workspace"),saved.at("request"),runs);std::cout<<json{{"run_id",result.at("run_id")},{"summary",result.at("summary")}}.dump(2)<<'\n';return 0;}
        if(!requestFile.empty()){const auto result=saveRun(read(workspace),read(requestFile),runs);std::cout<<json{{"run_id",result.at("run_id")},{"summary",result.at("summary")},{"output_directory",fs::absolute(runs/result.at("run_id").get<std::string>()).string()}}.dump(2)<<'\n';return 0;}
        // Read-only baseline. Only this engine's isolated run folders are written.
        read(workspace);httplib::Server server;std::mutex exportMutex;server.set_payload_max_length(20*1024*1024);server.set_read_timeout(30,0);server.set_write_timeout(180,0);
        server.set_default_headers({{"Cache-Control","no-store"},{"X-Content-Type-Options","nosniff"},{"Referrer-Policy","no-referrer"}});
        auto reply=[](httplib::Response& res,const json& value){res.set_content(value.dump(),"application/json");};
        auto allowed=[&](const httplib::Request& req,httplib::Response& res){const auto origin=req.get_header_value("Origin");if(req.get_header_value("Sec-Fetch-Site")=="cross-site" || (!origin.empty()&&origin!="http://127.0.0.1:"+std::to_string(port)&&origin!="http://localhost:"+std::to_string(port))){res.status=403;reply(res,{{"error","Use this engine's local test screen"}});return false;}return true;};
        auto guarded=[&](auto action){return [&,action](const httplib::Request& req,httplib::Response& res){try{action(req,res);}catch(const std::invalid_argument& e){res.status=400;reply(res,{{"error",e.what()}});}catch(const json::exception& e){res.status=400;reply(res,{{"error",std::string("Invalid input: ")+e.what()}});}catch(const std::out_of_range& e){res.status=404;reply(res,{{"error",e.what()}});}catch(const std::exception& e){res.status=500;reply(res,{{"error",e.what()}});}};};
        server.Get("/api/engine/config",guarded([&](const auto&,auto& res){
            const auto state=read(workspace);const auto model=onetype::compile(state);std::set<std::string> makers;json categories=json::object();std::string capture;
            for(const auto& p:model.products.items())if(p.value().at("manufacturer")!="")makers.insert(p.value().at("manufacturer").get<std::string>());
            for(const auto& s:state.at("sources")){if(s.contains("category_labels"))categories.update(s.at("category_labels"));if(s.at("kind")=="catalog")capture=std::max(capture,s.at("captured_at").template get<std::string>());}
            reply(res,{{"company","Adafruit"},{"products",model.products.size()},{"base_revision",state.value("revision",0)},{"catalog_captured_at",capture},{"metrics",onetype::engineMetrics()},{"manufacturers",makers},{"category_labels",categories}});
        }));
        server.Post("/api/engine/run",guarded([&](const auto& req,auto& res){if(!allowed(req,res))return;const auto result=saveRun(read(workspace),json::parse(req.body),runs);reply(res,publicResult(result));}));
        server.Get("/api/engine/run",guarded([&](const auto& req,auto& res){reply(res,publicResult(read(directory(runs,req.get_param_value("id"))/"result.json")));}));
        server.Get("/api/engine/runs",guarded([&](const auto&,auto& res){std::vector<fs::path> files;if(fs::exists(runs))for(const auto& e:fs::directory_iterator(runs))if(e.is_directory()&&fs::exists(e.path()/"meta.json"))files.push_back(e.path()/"meta.json");std::sort(files.rbegin(),files.rend());json history=json::array();for(std::size_t i=0;i<std::min<std::size_t>(20,files.size());++i)history.push_back(read(files[i]));reply(res,history);}));
        server.Post("/api/engine/excel",guarded([&](const auto& req,auto& res){if(!allowed(req,res))return;const auto input=json::parse(req.body);const auto id=input.at("run_id").template get<std::string>();const auto dir=directory(runs,id);if(!fs::exists(dir/"result.json"))throw std::out_of_range("Run was not found");std::unique_lock<std::mutex> lock(exportMutex,std::try_to_lock);if(!lock.owns_lock()){res.status=409;reply(res,{{"error","Another workbook is being exported. Try again when it finishes."}});return;}excel(dir);reply(res,{{"url","/api/engine/download?run="+id+"&file=workbook.xlsx"}});}));
        server.Get("/api/engine/download",guarded([&](const auto& req,auto& res){const auto id=req.get_param_value("run"),name=req.get_param_value("file");const std::set<std::string> names{"products.csv","changes.csv","evidence.csv","sources.csv","unmatched.csv","correlations.csv","result.json","inputs.json","workbook.xlsx"};if(!names.count(name))throw std::invalid_argument("Unknown output file");const auto path=directory(runs,id)/name;res.set_header("Content-Disposition","attachment; filename=adafruit-"+id+"-"+name);res.set_content(bytes(path),name=="workbook.xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":name.find(".csv")!=std::string::npos?"text/csv; charset=utf-8":"application/json");}));
        server.Get("/",[&](const auto&,auto& res){res.set_content(bytes("dist/engine.html"),"text/html");});
        if(!server.set_mount_point("/assets","dist"))throw std::runtime_error("Missing dist directory");
        std::cout<<"Adafruit engine: http://127.0.0.1:"<<port<<"\nRead-only baseline: "<<workspace<<"\nRun outputs: "<<fs::absolute(runs)<<std::endl;
        if(!server.listen("127.0.0.1",port))throw std::runtime_error("Cannot bind engine port. Use --port 4182.");
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
