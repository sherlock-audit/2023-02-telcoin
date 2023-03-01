require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: 'https://polygon-rpc.com/',
        blockNumber: 38244756
      }
    }
  },
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
};
