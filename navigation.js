'use strict'
const { Movements } = require('mineflayer-pathfinder')

module.exports = (bot, options = {}) => {
  const movements=new Movements(bot)
  movements.canDig=Boolean(options.returning)
  movements.allow1by1towers=false
  movements.allowParkour=!options.returning
  movements.maxDropDown=3
  movements.scafoldingBlocks=options.returning?['cobblestone','cobbled_deepslate','dirt','netherrack'].map(name=>bot.registry.itemsByName[name]?.id).filter(Number.isFinite):[]
  if(options.returning){
    movements.getMoveDiagonal=()=>{}
    movements.allowSprinting=false
    for(const block of bot.registry.blocksArray)
      if(/_ore$|ancient_debris|obsidian|chest|barrel|furnace|crafting_table|smithing_table|anvil|enchanting_table|bookshelf/.test(block.name))movements.blocksCantBreak.add(block.id)
    const exclude=(block,breaking)=>{
      if(options.protectedBase?.(block.position))return 100
      for(const offset of [[0,0,0],[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]])
        if(/water|lava|fire|magma_block/.test(bot.blockAt(block.position.offset(...offset))?.name||''))return 100
      if(breaking&&[block,bot.blockAt(block.position.offset(0,1,0))].some(b=>/^(sand|red_sand|gravel)$/.test(b?.name||'')))return 100
      return 0
    }
    movements.exclusionAreasBreak.push(block=>exclude(block,true))
    movements.exclusionAreasPlace.push(block=>exclude(block,false))
  }
  movements.canOpenDoors=true
  for(const block of bot.registry.blocksArray)
    if(/_door$/.test(block.name)&&block.name!=='iron_door')movements.openable.add(block.id)
  const getBlock=movements.getBlock.bind(movements)
  movements.getBlock=(...args)=>{
    const block=getBlock(...args)
    if(/_door$/.test(block.name)&&block.name!=='iron_door'){
      const properties=block.getProperties()
      block.physical=false
      block.height=block.position.y
      block.safe=properties.open||properties.half==='upper'
      block.openable=!properties.open&&properties.half==='lower'
    }
    return block
  }
  if(!options.returning){
    const diagonal=movements.getMoveDiagonal.bind(movements)
    movements.getMoveDiagonal=(node,dir,neighbors)=>{
      for(const [x,z] of [[dir.x,0],[0,dir.z]])for(const y of [0,1]){
        const side=movements.getBlock(node,x,y,z)
        if(side.physical||!side.safe)return
      }
      diagonal(node,dir,neighbors)
    }
  }
  movements.exclusionAreasStep.push(block=>{
    const home=options.home,p=block.position
    if(options.returning&&home&&p.y>=home.y-4&&p.y<home.y-1&&Math.hypot(p.x-home.x,p.z-home.z)<12)return 100
    for(const offset of [[0,0,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
      const near=bot.blockAt(block.position.offset(...offset))
      if(near&&/lava|fire|magma_block/.test(near.name))return 100
    }
    return 0
  })
  return movements
}
