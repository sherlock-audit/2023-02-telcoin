// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IRootBridgeRelay {
  /**
  * @notice calls Polygon POS bridge for deposit
  * @dev the contract is designed in a way where anyone can call the function without risking funds
  * @dev MATIC cannot be bridged
  * @param token is address of the token that is desired to be pushed accross the bridge
  */
  function bridgeTransfer(address token) external payable;

  /**
   * @dev Emitted when ERC20 is bridged
   */
  event BridgeERC(address indexed destination, address indexed currency, uint256 amount);

  /**
   * @dev Emitted when ETH is bridged
   */
  event BridgeETH(address indexed destination, uint256 amount);

  /**
   * @dev Emitted when MATIC is attempted to be bridged
   */
  error MATICUnbridgeable();
}