// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.6;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../interfaces/IBlacklist.sol";

/**
 * @title Stablecoin
 * @author Amir Shirif Telcoin, LLC.
 *
 * @notice This is an ERC20 standard coin with advanced capabilities to allow for
 * minting and burning. This coin is pegged to a fiat currency and its value is
 * intended to reflect the value of its native currency
 * @dev Blacklisting has been included to prevent this currency from being used for illicit or nefarious activities
 */
contract Stablecoin is ERC20PresetMinterPauserUpgradeable, ERC20PermitUpgradeable, IBlacklist {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  event NameUpdated(string indexed name);
  event SymbolUpdated(string indexed symbol);
  event DescriptionUpdated(string indexed description);

  error AlreadyBlacklisted(address holder);
  error NotBlacklisted(address holder);

  mapping (address => bool) private _blacklist;

  bytes32 public constant META_ROLE = keccak256("META_ROLE");
  bytes32 public constant SUPPORT_ROLE = keccak256("SUPPORT_ROLE");
  bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
  bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

  string private _name;
  string private _symbol;
  uint8 private _decimals;
  string private _description;

  /**
   * @notice initializes the contract
   * @dev this function is called with proxy deployment to update state data
   * @dev uses initializer modifier to only allow one initialization per proxy
   * @param name_ is a string representing the token name
   * @param symbol_ is a string representing the token symbol
   * @param decimal_ is an int representing the number of decimals for the token
   * @param decimal_ is an int representing the number of decimals for the token
   */
  function init(string memory name_, string memory symbol_, uint8 decimal_, string memory description_) external reinitializer(2) {
    __ERC20PresetMinterPauser_init(name_, symbol_);
    __ERC20Permit_init(name_);
    _name = name_;
    _symbol = symbol_;
    _decimals = decimal_;
    _description = description_;
  }

  /**
   * @notice Returns the name of the token.
   */
  function name() public view override returns (string memory) {
    return _name;
  }

  /**
   * @notice Returns the symbol of the token
   */
  function symbol() public view override returns (string memory) {
    return _symbol;
  }

  /**
   * @notice Returns the number of decimal places
   */
  function decimals() public view override returns (uint8) {
    return _decimals;
  }

  /**
   * @notice Returns a currency description
   */
  function description() public view returns (string memory) {
    return _description;
  }

  /**
   * @notice Updates the _name field to a new string
   * @dev restricted to META_ROLE
   * @param name_ is the new _name
   */
  function updateName(string memory name_) external onlyRole(META_ROLE) {
    _name = name_;
    emit NameUpdated(_name);
  }

  /**
   * @notice Updates the _symbol field to a new string
   * @dev restricted to META_ROLE
   * @param symbol_ is the new _symbol
   */
  function updateSymbol(string memory symbol_) external onlyRole(META_ROLE) {
    _symbol = symbol_;
    emit SymbolUpdated(_symbol);
  }

  /**
   * @notice Updates the _description field to a new string
   * @dev restricted to META_ROLE
   * @param description_ is the new _description
   */
  function updateDescription(string memory description_) external onlyRole(META_ROLE) {
    _description = description_;
    emit DescriptionUpdated(_description);
  }

  /**
   * @notice Removes tokens from circulation from the callers's address
   * @dev See {ERC20BurnableUpgradeable-burn}.
   * @dev restricted to BURNER_ROLE
   * @param amount is the quantity that is to be burned
   *
   * Emits a {Transfer} event.
   */
  function burn(uint256 amount) public override onlyRole(BURNER_ROLE) {
    _burn(_msgSender(), amount);
  }

  /**
   * @notice Removes tokens from circulation from any address
   * @dev See {ERC20BurnableUpgradeable-burnFrom}.
   * @dev restricted to BURNER_ROLE
   * @param account the address the tokens are being burned from
   * @param amount the quantity that is to be burned
   *
   * Emits a {Transfer} event.
   */
  function burnFrom(address account, uint256 amount) public override onlyRole(BURNER_ROLE) {
    _spendAllowance(account, _msgSender(), amount);
    _burn(account, amount);
  }

  /**
   * @notice Returns a boolean representing that an address is blacklisted
   * @dev See {IBlacklist-blacklisted}.
   * @param holder is the address being evaluated
   * @return bool indicating whether the address is blacklisted
   */
  function blacklisted(address holder) public view override returns (bool) {
    return _blacklist[holder];
  }

  /**
   * @notice Adds an address to the mapping of blacklisted addresses
   * @dev See {IBlacklist-addBlackList}.
   * @param holder is the address being added to the blacklist
   *
   * Emits a {AddedBlacklist} event.
   */
  function addBlackList(address holder) external onlyRole(BLACKLISTER_ROLE) override {
    if (blacklisted(holder)) revert AlreadyBlacklisted(holder);
    _blacklist[holder] = true;
    emit AddedBlacklist(holder);
    removeBlackFunds(holder);
  }

  /**
   * @notice Removes an address to the mapping of blacklisted addresses
   * @dev See {IBlacklist-removeBlackList}.
   * @param holder is the address being removed from the blacklist
   *
   * Emits a {RemovedBlacklist} event.
   */
  function removeBlackList(address holder) external onlyRole(BLACKLISTER_ROLE) override {
    if (!blacklisted(holder)) revert NotBlacklisted(holder);
    _blacklist[holder] = false;
    emit RemovedBlacklist(holder);
  }

  /**
   * @notice Removes funds from blacklisted address
   * @param holder is the address having its funds removed
   */
  function removeBlackFunds(address holder) internal {
    uint256 funds = balanceOf(holder);
    _transfer(holder, _msgSender(), funds);
  }

  /**
   * @notice checks if destination has been previously blacklisted
   * @param destination is the address being checked for status
   */
  function _beforeTokenTransfer(address, address destination, uint256) internal view override(ERC20Upgradeable, ERC20PresetMinterPauserUpgradeable) {
    require(!blacklisted(destination), "Stablecoin: destination cannot be blacklisted address");
  }

  /**
   * @notice sends tokens accidently sent to contract
   * @dev restricted to SUPPORT_ROLE
   * @param token currency stuck in contract
   * @param destination address where funds are returned
   * @param amount is the amount being transferred
   */
  function erc20Rescue(IERC20Upgradeable token, address destination, uint256 amount) external onlyRole(SUPPORT_ROLE) {
    token.safeTransfer(destination, amount);
  }
}
