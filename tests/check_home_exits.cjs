const assert=require('node:assert/strict'),{Vec3}=require('../node_modules/vec3')
const home={x:-16,y:69,z:-29}
const bot={entity:{position:new Vec3(-28,56,-20)},blockAt:p=>{
  const height=p.x<-20?74:66
  return {name:p.y<height?'sandstone':p.y===height?'sand':'air',boundingBox:p.y<=height?'block':'empty',position:p}
}}
const exits=require('../home-exits')(bot,home)
assert(exits.length>0)
assert(exits.some(p=>p.y===75));assert(exits.some(p=>p.y===67))
assert(exits.every(p=>Math.hypot(p.x-home.x,p.z-home.z)>=15&&bot.blockAt(p).name==='air'&&bot.blockAt(p.offset(0,-1,0)).boundingBox==='block'))
const registry=require('../node_modules/prismarine-registry')('1.20.1')
const Block=require('../node_modules/prismarine-block')(registry)
bot.registry=registry
bot.blockAt=p=>{const b=Block.fromStateId(registry.blocksByName[p.y===70?'sand':'stone'].minStateId,0);b.position=p;return b}
const m=require('../navigation')(bot,{returning:true,home,protectedBase:()=>false})
assert.equal(m.exclusionBreak(bot.blockAt(new Vec3(0,68,0))),0,'Sand nearby does not forbid all sandstone tunnels')
assert.equal(m.exclusionBreak(bot.blockAt(new Vec3(0,69,0))),100,'Do not mine beneath falling sand')
assert.equal(m.exclusionPlace(bot.blockAt(new Vec3(0,69,0))),0,'Safe scaffold placement next to sand allowed')
assert.equal(m.exclusionStep(bot.blockAt(new Vec3(-16,66,-29))),100,'Avoid routing into the low protected floor of the base')
console.log('PASS: exits use actual terrain heights outside base; nearby sand allowed, falling sand protected, low base-floor route excluded')
