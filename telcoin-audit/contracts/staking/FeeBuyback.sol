// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

//imports
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../util/TieredOwnership.sol";
import "../interfaces/IFeeBuyback.sol";
import "../interfaces/ISimplePlugin.sol";

/**
 * @title FeeBuyback
 * @author Amir Shirif, Telcoin, LLC.
 * @notice Helps facilitate a secondary swap, if required, to allow the referrer of a user to receive a fraction of the generated transaction fee, based on the stake of the referrer.
 */
contract FeeBuyback is IFeeBuyback, TieredOwnership {
  using SafeERC20 for IERC20;
  //MATIC address
  address constant public MATIC = 0x0000000000000000000000000000000000001010;
  //1 inch aggregator address
  address immutable public _aggregator;
  //reward token
  IERC20 immutable public _telcoin;
  //destination of rewards
  ISimplePlugin immutable public _referral;

  //constructor
  constructor(address aggregator_, IERC20 telcoin_, ISimplePlugin referral_) TieredOwnership() {
    require(aggregator_ != address(0), "FeeBuyback: zero aggregator");
    _aggregator = aggregator_;
    _telcoin = telcoin_;
    _referral = referral_;
  }

  /**
   * @notice submits wallet transactions
   * @dev a secondary swap may occur
   * @dev staking contract updates may be made
   * @param wallet address of the primary transaction
   * @param walletData bytes wallet data for primary transaction
   * @param token address the token that is being swapped from in a secondary transaction
   * @param amount uint256 the quantity of the token being swapped
   * @param swapData bytes swap data from primary transaction
   * @return boolean representing if a referral transaction was made
   */
  function submit(address wallet, bytes memory walletData, address safe, address token, address recipient, uint256 amount, bytes memory swapData) external override payable onlyOwner() returns (bool) {
    //wallet validity check
    require(wallet != address(0), "FeeBuyback: zero wallet");
    //Perform user swap first
    //Verify success
    (bool walletResult,) = wallet.call{value: 0}(walletData);
    require(walletResult, "FeeBuyback: wallet transaction failed");

    //check if this is a referral transaction
    //if not exit execution
    if (token == address(0) || recipient == address(0) || amount == 0 ) {
      return false;
    }

    //if swapped token is in TEL, no swap is necessary
    //do simple transfer from and submit
    if (token == address(_telcoin)) {
      _telcoin.safeTransferFrom(safe, address(this), amount);
      _telcoin.safeApprove(address(_referral), _telcoin.balanceOf(address(this)));
      require(_referral.increaseClaimableBy(recipient, _telcoin.balanceOf(address(this))), "FeeBuyback: balance was not adjusted");
      return true;
    }

    //MATIC does not allow for approvals
    //ERC20s only
    if (token != MATIC) {
      IERC20(token).safeTransferFrom(safe, address(this), amount);
      IERC20(token).safeApprove(_aggregator, 0);
      IERC20(token).safeApprove(_aggregator, amount);
    }

    //Perform secondary swap from fee token to TEL
    //do simple transfer from and submit
    (bool swapResult,) = _aggregator.call{value: msg.value}(swapData);
    require(swapResult, "FeeBuyback: swap transaction failed");
    _telcoin.safeApprove(address(_referral), _telcoin.balanceOf(address(this)));
    require(_referral.increaseClaimableBy(recipient, _telcoin.balanceOf(address(this))), "FeeBuyback: balance was not adjusted");
    return true;
  }

  /**
  * @notice Sends ERC20 tokens trapped in contract to external address
  * @dev Only an owner is allowed to make this function call
  * @param account is the receiving address
  * @param externalToken is the token being sent
  * @param amount is the quantity being sent
  * @return boolean value indicating whether the operation succeeded.
  *
  * Emits a {Transfer} event.
  */
  function rescueERC20(address account, address externalToken, uint256 amount) public onlyExecutor() returns (bool) {
    if (externalToken != MATIC) {
      IERC20(externalToken).safeTransfer(account, amount);
    } else {
      (bool sent,) = executor().call{value: amount}("");
      require(sent, "FeeBuyback: MATIC send failed");
    }
    return true;
  }
}
