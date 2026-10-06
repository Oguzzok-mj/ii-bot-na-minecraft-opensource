const assert=require('node:assert/strict'),path=require('node:path'),{EventEmitter}=require('node:events')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const bot=new EventEmitter(),home={x:-16,y:69,z:-29},position=new Vec3(home.x,home.y,home.z)
const chestPositions=[position.offset(3,0,1),position.offset(4,0,1)]
let carried=[{slot:9,name:'diamond',type:1,count:10,stackSize:64,metadata:0},{slot:10,name:'diamond',type:1,count:10,stackSize:64,metadata:0},{slot:11,name:'raw_iron',type:2,count:64,stackSize:64,metadata:0},{slot:12,name:'lapis_lazuli',type:3,count:6,stackSize:64,metadata:0},{slot:13,name:'diamond_pickaxe',type:4,count:1,stackSize:1,metadata:0},{slot:14,name:'bread',type:5,count:10,stackSize:64,metadata:0}]
let stored=0
const containers=chestPositions.map((p,index)=>({inventoryStart:27,slots:Array(27).fill(null).map((value,slot)=>index===0&&slot>0?{type:99,count:64,stackSize:64}:null),close(){},async deposit(type,metadata,amount){
  let remaining=amount
  for(const item of carried.filter(item=>item.type===type)){const take=Math.min(item.count,remaining);item.count-=take;remaining-=take;if(!remaining)break}
  assert.equal(remaining,0)
  carried=carried.filter(item=>item.count)
  remaining=amount
  for(let slot=0;slot<this.slots.length&&remaining;slot++){
    const current=this.slots[slot]
    if(current&&current.type!==type)continue
    const take=Math.min(64-(current?.count||0),remaining)
    this.slots[slot]={type,metadata,count:(current?.count||0)+take,stackSize:64};remaining-=take
  }
  assert.equal(remaining,0);stored+=amount
}}))
Object.assign(bot,{game:{dimension:'overworld'},entity:{position},health:20,registry:{blocksByName:{}},inventory:{items:()=>carried},pathfinder:{goto:async()=>{}},blockAt:p=>({name:chestPositions.some(c=>c.equals(p))?'chest':'air',position:p}),openContainer:async block=>containers[chestPositions.findIndex(p=>p.equals(block.position))],supportFeature:()=>false,waitForTicks:async()=>{}})
const skills={limited:async p=>p,blocked:new Map(),key:p=>p.toString(),count:name=>carried.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0),goto:async()=>{},ui:{home},radar:{setTarget:()=>{}}}
;(async()=>{
  const module=require(path.join(root,'iron-skills'))(bot,skills)
  const result=await module.handle({command:'home_deposit',home,reserve:{diamond:12}})
  assert.equal(result.remaining,0);assert.equal(result.chests,2)
  assert.equal(result.deposited.diamond,8);assert.equal(result.deposited.raw_iron,64);assert.equal(result.deposited.lapis_lazuli,6)
  assert.equal(carried.filter(i=>i.name==='diamond').reduce((n,i)=>n+i.count,0),12)
  assert.equal(carried.find(i=>i.name==='diamond_pickaxe').count,1)
  assert.equal(carried.find(i=>i.name==='bread').count,10)
  assert.equal(stored,78)
  containers.forEach(c=>c.slots.fill({type:99,count:64,stackSize:64}))
  const full=await module.handle({command:'home_deposit',home})
  assert.equal(full.remaining,12);assert.equal(carried.filter(i=>i.name==='diamond').reduce((n,i)=>n+i.count,0),12)
  containers.forEach(c=>c.slots.fill(null))
  carried.push({slot:15,name:'wooden_pickaxe',type:6,count:1,stackSize:1,metadata:0},{slot:16,name:'iron_pickaxe',type:7,count:1,stackSize:1,metadata:0})
  const archived=await module.handle({command:'home_deposit',home,reserve:{diamond:12,iron_pickaxe:1},archive:true})
  assert.equal(archived.remaining,0)
  assert.equal(archived.deposited.wooden_pickaxe,1)
  assert(carried.some(item=>item.name==='iron_pickaxe'))
  assert(carried.some(item=>item.name==='diamond_pickaxe'))
  carried.push({slot:18,name:'netherrack',type:8,count:64,stackSize:64,metadata:0},{slot:19,name:'netherrack',type:8,count:64,stackSize:64,metadata:0},{slot:20,name:'dirt',type:9,count:64,stackSize:64,metadata:0})
  const terrain=await module.handle({command:'home_deposit',home,reserve:{diamond:12,netherrack:8},archive:true})
  assert.equal(terrain.deposited.netherrack,120)
  assert.equal(terrain.deposited.dirt,48)
  assert.equal(terrain.remaining,0)
  assert.equal(carried.filter(item=>item.name==='netherrack').reduce((n,item)=>n+item.count,0),8)
  bot.inventory.slots=[]
  bot.inventory.slots[5]={name:'diamond_helmet'}
  carried.push({slot:21,name:'iron_helmet',type:10,count:1,stackSize:1,metadata:0},{slot:22,name:'iron_helmet',type:10,count:1,stackSize:1,metadata:0,enchants:[{name:'protection',lvl:4}]},{slot:23,name:'calcite',type:11,count:5,stackSize:64,metadata:0})
  const armor=await module.handle({command:'home_deposit',home,reserve:{diamond:12,netherrack:8},archive:true})
  assert.equal(armor.deposited.iron_helmet,1)
  assert.equal(armor.deposited.calcite,5)
  assert(carried.some(item=>item.slot===22))
  assert.equal(bot.inventory.slots[5].name,'diamond_helmet')
  carried.push({slot:24,name:'obsidian',type:12,count:14,stackSize:64,metadata:0})
  const obsidian=await module.handle({command:'home_deposit',home,reserve:{diamond:12,netherrack:8},archive:true})
  assert.equal(obsidian.deposited.obsidian,14)
  assert(!carried.some(item=>item.name==='obsidian'))
  console.log('PASS: two home chests, multiple stacks, exact crafting reserve, full chest conservation, equipment and food retained')
})().catch(error=>{console.error(error);process.exitCode=1})
