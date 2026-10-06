const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Block=require(path.join(root,'node_modules/prismarine-block'))(registry)
const {Vec3}=require(path.join(root,'node_modules/vec3'))
function door(name,open,half){
  const data=registry.blocksByName[name]
  for(let id=data.minStateId;id<=data.maxStateId;id++){
    const block=Block.fromStateId(id,0)
    const p=block.getProperties()
    if(p.open===open&&p.half===half){block.position=new Vec3(1,half==='lower'?0:1,0);return block}
  }
  throw new Error('Door state not found')
}
let opened=false,hazard=false,iron=false
const bot={registry,blockAt:p=>{
  if(p.x===1&&p.z===0&&[0,1].includes(p.y))return door(iron?'iron_door':'spruce_door',opened,p.y===0?'lower':'upper')
  const block=Block.fromStateId(registry.blocksByName[hazard&&p.x===2&&p.y===0&&p.z===0?'lava':p.y<0?'stone':'air'].minStateId,0)
  block.position=p.clone();return block
}}
const navigation=require(path.join(root,'navigation'))(bot)
const p=new Vec3(1,0,0)
assert.equal(navigation.getBlock(p,0,0,0).safe,false)
assert.equal(navigation.getBlock(p,0,0,0).openable,true)
assert.equal(navigation.getBlock(p,0,1,0).safe,true)
opened=true
assert.equal(navigation.getBlock(p,0,0,0).safe,true)
assert.equal(navigation.getBlock(p,0,0,0).physical,false)
assert.equal(navigation.getBlock(p,0,0,0).openable,false)
iron=true;opened=false
assert.equal(navigation.getBlock(p,0,0,0).safe,false)
assert.equal(navigation.getBlock(p,0,0,0).openable,false)
assert.equal(navigation.exclusionStep(bot.blockAt(p)),0)
hazard=true
assert.equal(navigation.exclusionStep(bot.blockAt(p)),100)
assert.equal(navigation.maxDropDown,3)
assert.equal(navigation.canDig,false)
hazard=false
const returning=require(path.join(root,'navigation'))(bot,{returning:true,protectedBase:p=>p.x<0})
assert.equal(returning.canDig,true)
assert.deepEqual(returning.scafoldingBlocks,['cobblestone','cobbled_deepslate','dirt','netherrack'].map(name=>registry.itemsByName[name].id))
assert.equal(returning.allowParkour,false)
const diagonal=[];returning.getMoveDiagonal(null,null,diagonal);assert.equal(diagonal.length,0)
assert(returning.blocksCantBreak.has(registry.blocksByName.diamond_ore.id))
assert(returning.blocksCantBreak.has(registry.blocksByName.furnace.id))
assert.equal(returning.exclusionBreak(bot.blockAt(new Vec3(-1,0,0))),100)
hazard=true
assert.equal(returning.exclusionPlace(bot.blockAt(p)),100)
console.log('PASS: open wooden doors passable, closed lower door activated before traversal, iron doors excluded, lava-neighbor exclusion, safe drop limit')
