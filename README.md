# {project} contest details

- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)

# Resources

- [resource1](url)
- [resource2](url)

# On-chain context

TO FILL IN BY PROTOCOL

```
DEPLOYMENT: [e.g. mainnet, arbitrum, optimism, ..]
ERC20: [e.g. any, none, USDC, USDC and USDT]
ERC721: [e.g. any, none, UNI-V3]
ERC777: [e.g. any, none, {token name}]
FEE-ON-TRANSFER: [e.g. any, none, {token name}]
REBASING TOKENS: [e.g. any, none, {token name}]
ADMIN: [trusted, restricted, n/a]
EXTERNAL-ADMINS: [trusted, restricted, n/a]
```

In case of restricted, by default Sherlock does not consider direct protocol rug pulls as a valid issue unless the protocol clearly describes in detail the conditions for these restrictions. 
For contracts, owners, admins clearly distinguish the ones controlled by protocol vs user controlled. This helps watsons distinguish the risk factor. 
Example: 
* `ContractA.sol` is owned by the protocol. 
* `admin` in `ContractB` is restricted to changing properties in `functionA` and should not be able to liquidate assets or affect user withdrawals in any way. 
* `admin` in `ContractC` is user admin and is restricted to only `functionB`

# Audit scope


[telcoin-audit @ 4197d2547699d910238f1782572f4a95a1c40a2a](https://github.com/telcoin/telcoin-audit/tree/4197d2547699d910238f1782572f4a95a1c40a2a)
- [telcoin-audit/contracts/bridge/RootBridgeRelay.sol](telcoin-audit/contracts/bridge/RootBridgeRelay.sol)
- [telcoin-audit/contracts/interfaces/IBlacklist.sol](telcoin-audit/contracts/interfaces/IBlacklist.sol)
- [telcoin-audit/contracts/interfaces/IFeeBuyback.sol](telcoin-audit/contracts/interfaces/IFeeBuyback.sol)
- [telcoin-audit/contracts/interfaces/IPOSBridge.sol](telcoin-audit/contracts/interfaces/IPOSBridge.sol)
- [telcoin-audit/contracts/interfaces/IPlugin.sol](telcoin-audit/contracts/interfaces/IPlugin.sol)
- [telcoin-audit/contracts/interfaces/IRootBridgeRelay.sol](telcoin-audit/contracts/interfaces/IRootBridgeRelay.sol)
- [telcoin-audit/contracts/interfaces/ISimplePlugin.sol](telcoin-audit/contracts/interfaces/ISimplePlugin.sol)
- [telcoin-audit/contracts/stablecoin/Stablecoin.sol](telcoin-audit/contracts/stablecoin/Stablecoin.sol)
- [telcoin-audit/contracts/staking/FeeBuyback.sol](telcoin-audit/contracts/staking/FeeBuyback.sol)
- [telcoin-audit/contracts/staking/StakingModule.sol](telcoin-audit/contracts/staking/StakingModule.sol)
- [telcoin-audit/contracts/util/TieredOwnership.sol](telcoin-audit/contracts/util/TieredOwnership.sol)



# About {project}
