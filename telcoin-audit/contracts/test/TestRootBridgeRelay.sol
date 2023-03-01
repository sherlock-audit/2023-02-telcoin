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
//TESTING ONLY
contract TestRootBridgeRelay is IRootBridgeRelay {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  //TEST CHANGES
  //removed `constant` key words from MATIC_ADDRESS, POS_BRIDGE, and PREDICATE_ADDRESS
  //removed init values from MATIC_ADDRESS, POS_BRIDGE, PREDICATE_ADDRESS, and _owner
  //MATIC address
  IERC20Upgradeable public MATIC_ADDRESS;
  // mainnet PoS bridge
  IPOSBridge public POS_BRIDGE;
  // mainnet predicate
  address public PREDICATE_ADDRESS;
  //ETHER address
  address public ETHER_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  //owner safe
  address public _owner;
  //polygon network receiving address
  address payable public recipient = payable(address(this));
  //max integer value
  uint256 constant public MAX_INT = 2**256 - 1;

  //TEST CHANGES
  //Introduced constructor to init values
  constructor(IERC20Upgradeable matic, IPOSBridge pos, address predicate, address owner) {
    MATIC_ADDRESS = matic;
    POS_BRIDGE = pos;
    PREDICATE_ADDRESS = predicate;
    _owner = owner;
  }

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
  function erc20Rescue(address destination, uint256 amount) external {
    require(msg.sender == _owner, "RootBridgeRelay: caller must be owner");
    MATIC_ADDRESS.safeTransfer(destination, amount);
  }

  /**
  * @notice Get balance for testing
  * @return unt256 balance
  */
  function balanceOf() external view returns(uint256) {
    return address(this).balance;
  }

  /**
  * @notice receives ETHER
  */
  receive() external payable {}
}
