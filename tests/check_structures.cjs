const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Item=require(path.join(root,'node_modules/prismarine-item'))(registry)
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const world=new Map(),key=p=>`${p.x},${p.y},${p.z}`
const item=(name,count,slot)=>{const value=new Item(registry.itemsByName[name].id,count);value.slot=slot;return value}
let items=[item('obsidian',14,9),item('flint_and_steel',1,10)],placed=0
const position=new Vec3(-16,69,-29),ui={home:{x:-16,y:69,z:-29}}
const bot={registry,entity:{position},game:{dimension:'overworld'},inventory:{items:()=>items,slots:Array(46).fill(null)},waitForTicks:async()=>{},lookAt:async()=>{},pathfinder:{goto:async()=>{}},
  blockAt:p=>{const name=world.get(key(p))||(p.y===68?'stone':'air');return {name,position:p,boundingBox:['air','nether_portal'].includes(name)?'empty':'block'}},
  findBlock:({matching})=>{for(const [coordinates] of world){const p=new Vec3(...coordinates.split(',').map(Number)),block=bot.blockAt(p);if(matching(block))return block}return null},
  placeBlock:async(ref,face)=>{assert.equal(ref.boundingBox,'block');const p=ref.position.plus(face);assert.equal(bot.blockAt(p).name,'air');world.set(key(p),'obsidian');items.find(i=>i.name==='obsidian').count--;placed++},
  activateBlock:async(ref,face)=>world.set(key(ref.position.plus(face)),'nether_portal')}
const skills={limited:async p=>p,count:name=>items.filter(i=>i.name===name).reduce((sum,i)=>sum+i.count,0),goto:async()=>{},equip:async()=>{},ui}
;(async()=>{
  const module=require(path.join(root,'endgame-skills'))(bot,skills)
  const portal=await module.handle({command:'build_portal'})
  assert(portal.built&&portal.lit);assert.equal(placed,14)
  assert.equal([...world.values()].filter(n=>n==='obsidian').length,14)
  const repeat=await module.handle({command:'build_portal'})
  assert(repeat.lit);assert.equal(placed,14)
  const helmet=item('diamond_helmet',1,5);helmet.enchants=[{name:'protection',lvl:4}]
  bot.inventory.slots[5]=helmet
  items=[item('netherite_ingot',2,9),item('netherite_upgrade_smithing_template',2,10)]
  bot.unequip=async()=>{items.push(helmet);bot.inventory.slots[5]=null}
  const window={type:'minecraft:smithing',inventoryStart:4,inventoryEnd:40,slots:Array(40).fill(null),close(){}}
  bot.findBlock=()=>({name:'smithing_table',position})
  bot.openBlock=async()=>window
  bot.transfer=async options=>{
    const source=items.find(i=>i.type===options.itemType);assert(source)
    const moved=new Item(source.type,1,source.metadata,source.nbt);moved.slot=options.destStart
    window.slots[options.destStart]=moved;source.count--;items=items.filter(i=>i.count)
    if(window.slots[0]&&window.slots[1]&&window.slots[2])window.slots[3]=new Item(registry.itemsByName.netherite_helmet.id,1,0,window.slots[1].nbt)
  }
  bot.putAway=async slot=>{items.push(window.slots[slot]);window.slots[slot]=null}
  const upgraded=await module.handle({command:'smith_upgrade',item:'diamond_helmet'})
  assert.equal(upgraded.item,'netherite_helmet')
  assert.equal(items.find(i=>i.name==='netherite_ingot').count,1)
  assert.equal(items.find(i=>i.name==='netherite_upgrade_smithing_template').count,1)
  assert.equal(items.find(i=>i.name==='netherite_helmet').enchants[0].lvl,4)
  console.log('PASS: supported 14-block portal placement, ignition, reuse; 1.20.1 smithing slots, equipped armor, template consumption, enchantments retained')
})().catch(error=>{console.error(error);process.exitCode=1})
