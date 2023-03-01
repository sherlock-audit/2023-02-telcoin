const { ethers } = require("hardhat")

async function mine(blocks) {
  for (let i = 0; i < blocks; i++) {
    await ethers.provider.send("evm_mine", [])
  }
}

async function getLatestBlockNumber() {
  return (await ethers.provider.getBlock("latest")).number
}

function generateRandomAddress() {
  const randIntStr = Math.floor(Math.random() * 100000) + ""
  const randHex = "0x" + "0".repeat(64 - randIntStr.length) + randIntStr
  return ethers.utils.getAddress(
    ethers.utils.keccak256(randHex).substring(0, 42)
  )
}

function generateNRandomAddresses(n) {
  const ans = []

  for (let i = 0; i < n; i++) {
    ans.push(generateRandomAddress())
  }

  return ans
}

module.exports = {
  mine,
  getLatestBlockNumber,
  generateRandomAddress,
  generateNRandomAddresses
}
