// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IRootBridgeRelay.sol";
import "../interfaces/IPOSBridge.sol";

/**
 * @title RootBridgeRelay
 * @author Amir Shirif, Telcoin, LLC.
 * @notice this contract is meant for forwarding ERC20 and ETH accross the polygon bridge system
 */

contract RootBridgeRelay is IRootBridgeRelay {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  //MATIC address
  IERC20Upgradeable constant public MATIC_ADDRESS = IERC20Upgradeable(0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0);
  // mainnet PoS bridge
  IPOSBridge constant public POS_BRIDGE = IPOSBridge(0xA0c68C638235ee32657e8f720a23ceC1bFc77C77);
  // mainnet predicate
  address constant public PREDICATE_ADDRESS = 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf;
  //ETHER address
  address constant public ETHER_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  //owner safe
  address private _owner = 0x0711871682A45c256ECA5AEB477C0057AE9c5509;
  //polygon network receiving address
  address payable public recipient = payable(address(this));
  //max integer value
  uint256 constant public MAX_INT = 2**256 - 1;

  /**
  * @notice calls Polygon POS bridge for deposit
  * @dev the contract is designed in a way where anyone can call the function without risking funds
  * @dev MATIC cannot be bridged
  * @param token is address of the token that is desired to be pushed accross the bridge
  */
  function bridgeTransfer(address token) external override payable {
    if (IERC20Upgradeable(token) == MATIC_ADDRESS) {
      revert MATICUnbridgeable();
    }

    if (token == ETHER_ADDRESS) {
      transferETHToBridge();
    } else {
      transferERCToBridge(token);
    }
  }

  /**
  * @notice pushes ETHER transfers through to the PoS bridge
  * @dev WETH will be minted to the recipient
  */
  function transferETHToBridge() internal {
    uint256 balance = address(this).balance;
    POS_BRIDGE.depositEtherFor{value: balance}(recipient);
    emit BridgeETH(recipient, balance);
  }

  /**
  * @notice pushes token transfers through to the PoS bridge
  * @dev this is for ERC20 tokens that are not the matic token
  * @dev only tokens that are already mapped on the bridge will succeed
  * @param token is address of the token that is desired to be pushed accross the bridge
  */
  function transferERCToBridge(address token) internal {
    uint256 balance = IERC20Upgradeable(token).balanceOf(address(this));
    if (balance > IERC20Upgradeable(token).allowance(recipient, PREDICATE_ADDRESS)) {IERC20Upgradeable(token).safeApprove(PREDICATE_ADDRESS, MAX_INT);}
    POS_BRIDGE.depositFor(recipient, token, abi.encodePacked(balance));
    emit BridgeERC(recipient, token, balance);
  }

  /**
  * @notice helps recover MATIC which cannot be bridged with POS bridge
  * @dev onlyOwner may make function call
  * @param destination address where funds are returned
  * @param amount is the amount being migrated
  */
  function erc20Rescue(address destination, uint256 amount) external  {
    require(msg.sender == _owner, "RootBridgeRelay: caller must be owner");
    MATIC_ADDRESS.safeTransfer(destination, amount);
  }

  /**
  * @notice receives ETHER
  */
  receive() external payable {}
}
