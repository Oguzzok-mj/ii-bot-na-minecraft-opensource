const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
let disposed=0,copies=0,url=''
const geometry=()=>({dispose:()=>disposed++,translate:()=>{}})
const THREE={PlaneGeometry:function(){return geometry()},MeshBasicMaterial:function(){return {color:{setHex:()=>{}},dispose:()=>disposed++}},TextureLoader:function(){this.load=(source,ready)=>{url=source;ready({dispose:()=>disposed++})}},NearestFilter:1,DoubleSide:2}
const window={THREE}
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../items.js'),'utf8'),{window})
const meshes={}
const viewer={entities:{entities:meshes},camera:{quaternion:{}},updateEntity:e=>{if(e.delete){delete meshes[e.id];return};if(!meshes[e.id])meshes[e.id]={geometry:geometry(),material:{dispose:()=>disposed++},quaternion:{copy:()=>copies++}}}}
const frame=window.setupMineItems(viewer)
viewer.updateEntity({id:1,name:'item',itemName:'diamond'})
assert.equal(url,'/api/item-texture/diamond');assert.equal(disposed,2)
assert(meshes[1].material.map);frame();assert.equal(copies,1)
viewer.updateEntity({id:1,delete:true});frame();assert.equal(copies,1)
viewer.updateEntity({id:2,itemName:'cobbled_deepslate'});delete meshes[2];frame();assert.equal(copies,1)
console.log('PASS: dropped item texture, disposed fallback geometry, camera facing, entity deletion and world reset cleanup')
