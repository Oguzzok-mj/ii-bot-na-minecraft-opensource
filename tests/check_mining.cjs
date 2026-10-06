const path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const target=new Vec3(4,20,0),block={name:'iron_ore',position:target,boundingBox:'block',hardness:3}
let calls=0,dug=false,rayRange=0
const position=new Vec3(0,20,0)
const bot={entity:{position,eyeHeight:1.62},registry:{blocksByName:{}},nearestEntity:()=>null,
  findBlocks:()=>{calls++;return [target]},blockAt:p=>p.equals(target)&&!dug?block:{name:'stone',position:p,boundingBox:'block',hardness:1.5},
  canDigBlock:b=>b.position.distanceTo(position)<4.8,canSeeBlock:()=>false,
  world:{raycast:(eye,direction,range)=>{rayRange=range;assert(Math.abs(direction.norm()-1)<1e-6);return block}},
  waitForTicks:async()=>{},pathfinder:{goto:async()=>{}}}
const skills={limited:async p=>p,blocked:new Map(),key:p=>`${p.x},${p.y},${p.z}`,count:name=>name==='raw_iron'&&dug?1:0,
  dig:async b=>{assert.equal(b.name,'iron_ore');dug=true},goto:async()=>{},solid:b=>b?.boundingBox==='block',hazardous:()=>false,ui:{},radar:{setTarget:()=>{}}}
;(async()=>{
 const miner=require(path.join(root,'iron-skills'))(bot,skills)
 await miner.handle({command:'mine_resource',resource:'iron'})
 assert(dug);assert(rayRange>4);assert.equal(calls,1)
 console.log('PASS: direct ore ray, normalized direction with full reach, confirmed mining without legacy visibility rejection')
})().catch(e=>{console.error(e);process.exitCode=1})
