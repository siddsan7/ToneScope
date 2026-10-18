#include <tonescope/Streaming.h>
#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace tonescope;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
template<class F> void rejects(F&& f){bool rejected=false;try{f();}catch(const std::exception&){rejected=true;}require(rejected,"Invalid stream operation accepted");}
int main(){
 const auto base=std::filesystem::current_path().lexically_normal();
 const auto folder=base/("streaming-test-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
 std::filesystem::create_directory(folder);
 auto cleanup=[&]{if(folder.parent_path()==base)std::filesystem::remove_all(folder);};
 try{{
  const auto file=folder/"roundtrip.wav";
  std::array<float,4357> left{},right{};for(size_t n=0;n<left.size();++n){left[n]=float(.5*std::sin(n*.13));right[n]=-left[n];}
  {WavStreamWriter writer(file.string(),48000,2);for(int n=0;n<4357;n+=333){const float* in[]{left.data()+n,right.data()+n};writer.write(in,std::min(333,4357-n));}require(writer.frames()==4357,"Writer frame count");writer.finish();rejects([&]{const float* in[]{left.data(),right.data()};writer.write(in,1);});}
  WavStreamReader reader(file.string());require(reader.info().frames==4357&&reader.info().channels==2&&reader.info().floatingPoint,"Stream metadata");
  std::array<float,257>a{},b{};float* out[]{a.data(),b.data()};int offset=0;
  while(auto count=reader.read(out,257)){for(int i=0;i<count;++i){require(a[i]==left[offset+i]&&b[i]==right[offset+i],"Exact streaming sample roundtrip");}for(int i=count;i<257;++i)require(a[i]==0&&b[i]==0,"EOF tail initialized");offset+=count;}
  require(offset==4357&&reader.position()==4357,"Reader frame count");reader.seek(4200);require(reader.read(out,257)==157&&a[0]==left[4200],"Exact seek and short read");
  rejects([&]{reader.seek(-1);});rejects([&]{reader.seek(4358);});rejects([&]{reader.read(out,65537);});
  rejects([&]{WavStreamWriter exists(file.string(),48000,2);});
  {WavStreamWriter writer((folder/"nan.wav").string(),48000,1);float nan=std::numeric_limits<float>::quiet_NaN();const float* in[]{&nan};rejects([&]{writer.write(in,1);});rejects([&]{writer.finish();});}
  {std::ofstream bad(folder/"truncated.wav",std::ios::binary);bad.write("RIFF",4);}rejects([&]{WavStreamReader bad((folder/"truncated.wav").string());});
  // The open stream must detect a source becoming shorter, not return uninitialized samples.
  {std::ofstream truncated(file,std::ios::binary|std::ios::trunc);truncated.write("RIFF",4);}reader.seek(0);rejects([&]{reader.read(out,257);});
  }cleanup();std::cout<<"streaming tests passed\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';cleanup();return 1;}
}
