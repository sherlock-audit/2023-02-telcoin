# Telcoin

![hardhat](https://img.shields.io/badge/hardhat-^2.12.5-blue)
![coverage](https://img.shields.io/badge/coverage-80%25-yellowgreen)
![comments](https://img.shields.io/badge/comments-80%25-yellowgreen)
![please](https://img.shields.io/badge/node-v16.19.0-brightgreen.svg)

**Telcoin** is designed to complement telecom, mobile money, and e-wallet partners globally with both traditional fiat and blockchain transaction rails that underpin our fast and affordable digital financial service offerings. Telcoin combines the best parts of the burgeoning DeFi ecosystem with our compliance-first approach to each market, ensuring that the company takes on a fraction of traditional financial counterparty, execution, and custody risks.

# Contracts
**Protocol**:
`contracts/core/protocol/RootBridgeRelay.sol`: The goal of this contract is to work with the existing [Polygon POS bridge](https://wiki.polygon.technology/docs/category/calling-contracts) in order to enable bridging of any token to be support by the Telcoin platform, including but not limited to the list [here](https://tokenlists.org/token-list?url=https://raw.githubusercontent.com/telcoin/token-lists/master/telcoins.json), with the exception of bridging MATIC. This will work hand in hand with the stablecoins to be released as it will be used for the migration from Ethereum to Polygon. 

**Stablecoin**:
This single contract, `contracts/core/stablecoin/Stablecoin.sol`, will be deployed multiple times for different variations of fiat currencies behind proxies. 

**Staking**:
This was initially included in a previous audit. Some minor changes have been made. You can find its description [here](https://app.sherlock.xyz/audits/contests/25).

1. `FeeBuyback.sol` now takes in the safe as a parameter to allow different safes to be associated with different users.
2. `StakingModule.sol`
   1. Claim and exiting functions have been changed to affect behavior of tokens so that the latest set of rewards are not left behind.
   2. The delay module on the migrator has been removed.

# Scope
All contract within the `contracts` directory are within the scope of this audit, with the exception of all contracts within the `contracts/test` directory. These contracts are used for hardhat's unit tests only. There is a slight caveat to this however. Though many of the contracts in this directory are for testing purposes only and are either not contracts that Telcoin has deployed or is responsible for, some are slightly augmented versions of other contracts inside the scope. The reason for this is to facilitate testing. Namely, the `RootBridgeRelay.sol` is an existing contract behind a proxy. Due to the nature of how this contract is currently in use, it makes more sense to have hardcoded values when switching between implementations, rather than reinitializing the contracts. In the test version, a constructor is used instead to allow for passing in the addresses of these generated dependencies. When using manual review, we suggest auditors stick to all non-test based contracts. For automated tools and unit tests are used, the reverse may be beneficial. 

# Trusted Authorities
These products will be interacting with a diverse number of third party providers, both on and off chain:
1. [Polygon](https://wiki.polygon.technology/docs/category/calling-contracts)
2. [1inch](https://docs.1inch.io/)
3. [OpenZeppelin](https://docs.openzeppelin.com/contracts/4.x/)

# Running Tests

To get started, all you should need to install dependencies and run the unit tests are here.
```shell
npm install
npx hardhat test
```

If you are having issues, try cleaning the environment.
```shell
npx hardhat clean
```

For coverage, please run these commands.
```shell
npx hardhat coverage
npx hardhat clean
```

# Diagrams

Here are some supplementary diagrams to help visualize how contracts will interact with one another. 

![](docs/diagrams/UML_FBB.svg)
Image 1: Fee buy back contract arrangement

![](docs/diagrams/Composition_FBB.svg)
Image 2: Data package distribution

```
                                     ttttttttttttttt,                           
                              *tttttttttttttttttttttttt,                        
                       *tttttttttttttttttttttttttttttttttt,                     
                ,tttttttttttttttttttttttttttttttttttttttttttt,                  
          .ttttttttttttttttttttttttttttttttttttttttttttttttttttt.               
        ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt.            
       ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt.         
      ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt       
     .ttttttttttttttttttttttttttttttttt    ttttttttttttttttttttttttttttttttt.   
     tttttttttttttttttttttttttttttttt     *ttttttttttttttttttttttttttttttttttt. 
     ttttttttttttttttttttttttttttt.       ttttttttttttttttttttttttttttttttttttt,
    *ttttttttttttttttttttttttt,          ************ttttttttttttttttttttttttttt
    tttttttttttttttttttttttt                        tttttttttttttttttttttttttttt
   *ttttttttttttttttttttttt*                        ttttttttttttttttttttttttttt,
   ttttttttttttttttttttttttttttt        *tttttttttttttttttttttttttttttttttttttt 
  ,tttttttttttttttttttttttttttt,       ,tttttttttttttttttttttttttttttttttttttt* 
  ttttttttttttttttttttttttttttt        ttttttttttttttttttttttttttttttttttttttt  
  tttttttttttttttttttttttttttt.       ,ttttttttttttttttttttttttttttttttttttttt  
 ttttttttttttttttttttttttttttt        ttttttttttttttttttttttttttttttttttttttt   
 ttttttttttttttttttttttttttttt        ttttttttttttttttttttttttttttttttttttttt   
 ttttttttttttttttttttttttttttt         *********tttttttttttttttttttttttttttt.   
 ttttttttttttttttttttttttttttt*                 tttttttttttttttttttttttttttt    
  *ttttttttttttttttttttttttttttt               tttttttttttttttttttttttttttt*    
    .tttttttttttttttttttttttttttttttttttttttttt*ttttttttttttttttttttttttttt     
       .ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt     
          .ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt      
             .tttttttttttttttttttttttttttttttttttttttttttttttttttttttttt,       
                .ttttttttttttttttttttttttttttttttttttttttttttttttttttt          
                   ,ttttttttttttttttttttttttttttttttttttttttttt*                
                      ,ttttttttttttttttttttttttttttttttt*                       
                         ,tttttttttttttttttttttttt.                             
                            ,*ttttttttttttt.                                    
```