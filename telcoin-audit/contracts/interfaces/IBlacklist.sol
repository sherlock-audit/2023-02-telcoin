// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.6;

/**
 * @title IBlacklist
 * @author Amir Shirif Telcoin, LLC.
 * @dev Implements Openzeppelin Audited Contracts
 * @notice Provides the ability for an ERC20 token to blacklist an address
 */
interface IBlacklist {
  /**
  * @notice Returns a boolean representing that an address is blacklisted
  * @param holder is the address being evaluated
  * @return bool true if the address is blacklisted
  */
  function blacklisted(address holder) external view returns (bool);

  /**
  * @notice Adds an address to the mapping of blacklisted addresses
  * @dev Intended to trigger a call to removeBlackFunds()
  * @param holder is the address being added to the blacklist
  *
  * Emits a {AddedBlacklist} event.
  */
  function addBlackList(address holder) external;

  /**
  * @notice Removes an address to the mapping of blacklisted addresses
  * @param holder is the address being removed from the blacklist
  *
  * Emits a {RemovedBlacklist} event.
  */
  function removeBlackList(address holder) external;

  /**
   * @dev Emitted when the address of a `holder` is added to the blacklist by
   * a call to {addBlackList}. `holder` is the blacklist address
   */
  event AddedBlacklist(address holder);

  /**
   * @dev Emitted when the address of a `holder` is removed to the blacklist by
   * a call to {removeBlackList}. `holder` is the blacklist address
   */
  event RemovedBlacklist(address holder);
}
