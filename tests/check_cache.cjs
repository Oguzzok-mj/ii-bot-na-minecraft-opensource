const path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const position=new Vec3(0,20,0),target=new Vec3(2,20,0),chestPosition=new Vec3(1,20,1)
const item=(slot,name,type,count=1)=>({slot,name,type,count,metadata:0,stackSize:64})
let carried=[item(9,'diamond_pickaxe',1),item(10,'diamond',2,5),item(11,'coal',3,3),item(12,'oak_planks',4,11),item(13,'stick',5,12),...Array.from({length:25},(_,i)=>item(14+i,'cobblestone',6,64))]
let removed=false
const deposited=[]
const chest={deposit:async(type,meta,count)=>{deposited.push({type,count});for(const i of carried.filter(i=>i.type===type)){const amount=Math.min(count,i.count);i.count-=amount;count-=amount;if(!count)break}carried=carried.filter(i=>i.count)},close:()=>{}}
const block={name:'diamond_ore',position:target,hardness:3,boundingBox:'block'}
const bot={entity:{position},registry:{blocksByName:{}},inventory:{items:()=>carried,emptySlotCount:()=>36-carried.length},
  findBlock:()=>({name:'chest',position:chestPosition}),findBlocks:()=>[target],nearestEntity:()=>null,
  blockAt:p=>p.equals(target)?removed?{name:'air',position:target}:block:{name:'stone',position:p,boundingBox:'block'},
  world:{raycast:()=>block},canDigBlock:()=>true,canSeeBlock:()=>true,openContainer:async()=>chest,supportFeature:()=>false,waitForTicks:async()=>{}}
const skills={limited:async p=>p,blocked:new Map(),key:p=>p.toString(),count:name=>carried.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0),
  dig:async()=>{removed=true;carried.find(i=>i.name==='diamond').count++},goto:async()=>{},solid:b=>b?.boundingBox==='block',hazardous:()=>false,ui:{},radar:{setTarget:()=>{}}}
;(async()=>{
 await require(path.join(root,'iron-skills'))(bot,skills).handle({command:'mine_resource',resource:'diamond'})
 assert(bot.inventory.emptySlotCount()>7)
 assert(deposited.every(i=>i.type===6))
 assert.equal(skills.count('diamond'),6);assert.equal(skills.count('diamond_pickaxe'),1);assert.equal(skills.count('cobblestone'),64)
 assert.equal(skills.ui.stashes.length,1)
 console.log('PASS: inventory room for full equipment, surplus safely stashed, diamonds and supplies retained, chest ESP marker')
})().catch(e=>{console.error(e);process.exitCode=1})
