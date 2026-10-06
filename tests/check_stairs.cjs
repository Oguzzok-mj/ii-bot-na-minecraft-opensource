const assert=require('node:assert/strict')
const {Vec3}=require('../node_modules/vec3')
const target=new Vec3(4,20,0),pit=new Vec3(2,29,0),dug=[]
const bot={game:{dimension:'overworld'},entity:{position:new Vec3(0,30,0),eyeHeight:1.62},inventory:{emptySlotCount:()=>36},
  registry:{blocksByName:{}},nearestEntity:()=>null,findBlocks:()=>[target],
  blockAt:p=>({position:p,name:p.equals(target)?'iron_ore':'stone',boundingBox:'block',hardness:1.5}),
  canDigBlock:()=>true,canSeeBlock:()=>false,world:{raycast:()=>bot.blockAt(pit)},waitForTicks:async()=>{},
  pathfinder:{goto:async goal=>{bot.entity.position=new Vec3(goal.x,goal.y,goal.z)}}}
const skills={limited:async p=>p,blocked:new Map(),key:p=>p.toString(),count:()=>0,ui:{},radar:{setTarget:()=>{}},
  solid:b=>b?.boundingBox==='block',hazardous:()=>false,dig:async b=>dug.push(b.position),goto:async()=>{}}
;(async()=>{
  await require('../iron-skills')(bot,skills).handle({command:'mine_resource',resource:'iron'})
  assert(!dug.some(p=>p.equals(pit)),'Do not excavate a remote pit before walking down')
  assert.deepEqual(bot.entity.position,new Vec3(1,29,0))
  assert(dug.every(p=>p.x===1&&p.z===0&&p.y>=29),'Only the staircase corridor is carved')
  assert.deepEqual(skills.ui.miningTrail.overworld,[{x:0,y:30,z:0},{x:1,y:29,z:0}])
  bot.entity.position=new Vec3(0,10,0)
  dug.length=0
  bot.findBlocks=()=>[new Vec3(4,16,0)]
  bot.world.raycast=()=>null
  skills.ui.miningTrail={overworld:[{x:-1,y:9,z:0}],the_nether:[{x:2,y:15,z:3}]}
  const ascent=require('../iron-skills')(bot,skills)
  await ascent.handle({command:'mine_resource',resource:'iron'})
  assert(dug.some(p=>p.equals(new Vec3(0,12,0))),'Clear overhead in the current cell before jumping up')
  assert.equal(bot.entity.position.y,11)
  assert.deepEqual(skills.ui.miningTrail.overworld[0],{x:-1,y:9,z:0})
  bot.entity.position=new Vec3(0,10,0);dug.length=0
  bot.world.raycast=()=>bot.blockAt(new Vec3(1,10,0))
  await require('../iron-skills')(bot,skills).handle({command:'mine_resource',resource:'iron'})
  assert.equal(bot.entity.position.y,11)
  assert(!dug.some(p=>p.equals(new Vec3(1,10,0))),'Keep the step support when a ray toward higher ore intersects it')
  bot.entity.position=new Vec3(0,10,0);dug.length=0
  bot.findBlocks=()=>[new Vec3(4,9,0)];bot.world.raycast=()=>null
  await require('../iron-skills')(bot,skills).handle({command:'mine_resource',resource:'iron'})
  assert.equal(bot.entity.position.y,9,'A target exactly one block below requires descending, including dropped ore in a shallow pit')
  const originalBlockAt=bot.blockAt
  bot.entity.position=new Vec3(0,10,0);dug.length=0
  bot.blockAt=p=>p.x===1&&p.z===1?{name:'gravel',position:p,boundingBox:'block',hardness:1}:originalBlockAt(p)
  skills.hazardous=b=>['sand','gravel'].includes(b?.name)
  await require('../iron-skills')(bot,skills).handle({command:'mine_resource',resource:'iron'})
  assert.deepEqual(bot.entity.position,new Vec3(1,9,0),'Adjacent gravel outside the corridor does not prevent a safe staircase')
  bot.entity.position=new Vec3(0,10,0);dug.length=0
  bot.blockAt=p=>p.equals(new Vec3(1,12,0))?{name:'gravel',position:p,boundingBox:'block',hardness:1}:originalBlockAt(p)
  await require('../iron-skills')(bot,skills).handle({command:'mine_resource',resource:'iron'})
  assert(!dug.some(p=>p.equals(new Vec3(1,11,0))),'Never excavate the support directly underneath gravel')
  console.log('PASS: downward ore ray creates a supported staircase and moves down; no remote pit or support removal')
})().catch(error=>{console.error(error);process.exitCode=1})
