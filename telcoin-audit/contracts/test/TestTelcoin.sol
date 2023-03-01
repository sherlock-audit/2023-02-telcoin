// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/*
* @title Telcoin
* @dev A standard ERC20 token using OpenZeppelin Contracts
*/
//TESTING ONLY
contract TestTelcoin is ERC20 {
  constructor (address recipient) ERC20("Telcoin", "TEL") {
    _mint(recipient, 100000000000 * (10 ** uint256(decimals())));
  }
}
