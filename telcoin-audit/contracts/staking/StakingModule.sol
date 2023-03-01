// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CheckpointsUpgradeable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../interfaces/IPlugin.sol";

// TODO: improve require messages

/// @title Staking Module
/// @notice Users interact directly with this contract to participate in staking. 
/// @dev This contract holds user funds. It does not accrue any staking yield on its own, it must have one or more `IPlugin` contracts "connected" to it.
contract StakingModule is ReentrancyGuardUpgradeable, AccessControlEnumerableUpgradeable {
    using CheckpointsUpgradeable for CheckpointsUpgradeable.History;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using BytesLib for bytes;

    /// @notice This role grants the ability to slash users' stakes at its own discretion
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    /// @notice This role grants the ability to add and remove IPlugin contracts
    bytes32 public constant PLUGIN_EDITOR_ROLE = keccak256("PLUGIN_EDITOR_ROLE");
    /// @notice This role grants the ability to rescue ERC20 tokens that do not rightfully belong to this contract
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");
    /// @notice This role grants the ability to migrate user funds
    bytes32 public constant MIGRATOR_ROLE = keccak256("MIGRATOR_ROLE");

    /// @notice The amount of time a user has to withdraw once the withdrawal delay has elapsed after requesting withdrawal
    uint256 public withdrawalWindow;
    /// @notice The withdrawal delay for preventing slash frontrunning
    uint256 public withdrawalDelay;
    /// @notice Maximum allowable withdrawal delay
    /// @dev If there was no maximum, the delay could be very large which would prevent users from withdrawing
    uint256 public maxWithdrawalDelay;
    /// @notice Minimum allowable difference between withdrawal window and withdrawal delay
    /// @dev If there was no minimum, the window could be set to 0 which would prevent users from withdrawing
    uint256 public minWithdrawalWindow;

    /// @notice TEL ERC20 address
    address public tel;

    /// @notice Array of all connected IPlugin contracts
    address[] public plugins;

    /// @notice Number of currently connected Plugins
    uint256 public nPlugins;

    /// @notice Maps a Plugin to whether or not it is included in `plugins`
    /// @dev This allows duplicate plugins to be prevented
    mapping(address => bool) public pluginsMapping;

    /// @notice Maps a plugin to its index in the plugins array
    /// @dev A plugin that is not in the plugins array does not necessarily map to 0
    mapping(address => uint256) public pluginIndicies;

    /// @notice Maps an account to a timestamp when they can call any withdrawal function. If zero, then a withdrawal hasn't been requested.
    /// @dev If withdrawalDelay is zero, then the user does not need to request a withdrawal first
    mapping(address => uint256) public withdrawalRequestTimestamps;

    /// @notice Total TEL staked by users in this contract
    uint256 private _totalStaked;
    /// @notice Maps an account to its staked amount history
    mapping(address => CheckpointsUpgradeable.History) private _stakes;

    /// @dev The header of an auxData payload is an array of HeaderItem's
    /// @dev The purpose of the HeaderItem(s) is to mark which parts of the data payload are for which plugins
    struct AuxDataHeaderItem {
        address addr;
        uint256 start;
        uint256 len;
    }

    /// @notice An event that's emitted when a account's stake changes (deposit/withdraw/slash)
    event StakeChanged(address indexed account, uint256 oldStake, uint256 newStake);
    /// @notice An event that's emitted when an account claims some yield
    event Claimed(address indexed account, uint256 amount);
    /// @notice An event that's emitted when an account's stake is slashed
    event Slashed(address indexed account, uint256 amount);

    /// @notice An event that's emitted when a plugin is added
    event PluginAdded(address indexed plugin, uint256 nPlugins);
    /// @notice An event that's emitted when a plugin is removed
    event PluginRemoved(address indexed plugin, uint256 nPlugins);

    /// @notice An event that's emitted when a call to a plugin's claim function reverts
    event PluginClaimFailed(address indexed plugin);

    /// @notice An event that's emitted when a call to a plugin's notifyStakeChange function reverts
    event StakeChangeNotificationFailed(address indexed plugin);

    function initialize(address _telAddress, uint256 _maxWithdrawalDelay, uint256 _minWithdrawalWindow) public initializer {
        tel = _telAddress;
        maxWithdrawalDelay = _maxWithdrawalDelay;
        minWithdrawalWindow = _minWithdrawalWindow;

        // initialize OZ stuff
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init_unchained();
        AccessControlEnumerableUpgradeable.__AccessControlEnumerable_init_unchained();

        // set deployer as ADMIN
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    modifier checkpointProtection(address account) {
        uint256 numCheckpoints = _stakes[account]._checkpoints.length;
        require(numCheckpoints == 0 || _stakes[account]._checkpoints[numCheckpoints - 1]._blockNumber != block.number, "StakingModule: Cannot exit in the same block as another stake or exit");
        _;
    }

    modifier delayedWithdrawal() {
        require(withdrawalDelay == 0 || (
                withdrawalRequestTimestamps[msg.sender] + withdrawalDelay <= block.timestamp &&
                block.timestamp <= withdrawalRequestTimestamps[msg.sender] + withdrawalDelay + withdrawalWindow
            ), 
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
        );
        withdrawalRequestTimestamps[msg.sender] = 0;
        _;
    }
    
    /************************************************
    *   view functions
    ************************************************/

    /// @notice Parses auxiliary data into a bytes[] with length nPlugins
    function parseAuxData(bytes calldata auxData) public view returns (bytes[] memory) {
        bytes[] memory arr = new bytes[](nPlugins);

        if (auxData.length == 0) {
            return arr;
        }
        
        (AuxDataHeaderItem[] memory header, bytes memory payload) = abi.decode(auxData, (AuxDataHeaderItem[], bytes));

        for (uint256 i = 0; i < header.length; i++) {
            require(pluginsMapping[header[i].addr], "StakingModule: Invalid Plugin when parsing auxData");
            arr[pluginIndicies[header[i].addr]] = payload.slice(header[i].start, header[i].len);
        }
        
        return arr;
    }

    /// @dev For some future Plugins not yet ideated, totalClaimable may be hard or impossible to implement. 
    /// @dev This would break `totalSupply`, but `totalSupply` is not strictly necessary anyway.
    /// @return Total supply of staked TEL, including all yield
    function totalSupply() external view returns (uint256) {
        uint256 total;

        // loop over all plugins and sum up totalClaimable
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).totalClaimable();
        }
        
        // totalSupply is the total claimable from all plugins plus the total amount staked
        return total + _totalStaked;
    }

    /// @return Balance of an account. This includes stake and claimable yield.
    /// @param account Account to query balance of
    /// @param auxData Auxiliary data to pass to plugins
    function balanceOf(address account, bytes calldata auxData) public view returns (uint256) {
        return _stakes[account].latest() + claimable(account, auxData);
    }

    /// @return Balance of an account at a specific block. This includes stake and claimable yield.
    /// @param account Account to query balance of
    /// @param blockNumber Block at which to query balance
    /// @param auxData Auxiliary data to pass to plugins
    function balanceOfAt(address account, uint256 blockNumber, bytes calldata auxData) external view returns (uint256) {
        return stakedByAt(account, blockNumber) + claimableAt(account, blockNumber, auxData);
    }

    /// @return Total amount staked by all accounts
    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    /// @dev Checks `claimable(account)` of all Plugins and returns the total.
    /// @param account Account to query balance of
    /// @param auxData Auxiliary data to pass to plugins
    /// @return Total amount claimable by an account
    function claimable(address account, bytes calldata auxData) public view returns (uint256) {
        uint256 total;
        // loop over all plugins, sum claimable of account
        bytes[] memory parsedAuxData = parseAuxData(auxData);
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).claimable(account, parsedAuxData[i]);
        }
        return total;
    }

    /// @dev Checks `claimableAt(account, blockNumber)` of all Plugins.
    /// @param account Account to query claimable amount
    /// @param blockNumber Block at which to query claimable amount
    /// @param auxData Auxiliary data to pass to plugins
    /// @return Total amount claimable by an account at a specific block number.
    function claimableAt(address account, uint256 blockNumber, bytes calldata auxData) public view returns (uint256) {
        uint256 total;
        // loop over all plugins, sum claimableAt of account
        bytes[] memory parsedAuxData = parseAuxData(auxData);
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).claimableAt(account, blockNumber, parsedAuxData[i]);
        }
        return total;
    }

    /// @return Amount staked by an account. This does not include claimable yield from plugins.
    /// @param account Account to query staked amount
    function stakedBy(address account) external view returns (uint256) {
        return _stakes[account].latest();
    }

    /// @return Amount staked by an account at a specific block number excluding claimable yield.
    /// @param account Account to query staked amount
    /// @param blockNumber Block at which to query staked amount
    function stakedByAt(address account, uint256 blockNumber) public view returns (uint256) {
        return _stakes[account].getAtBlock(blockNumber);
    }

    /************************************************
    *   external mutative functions
    ************************************************/

    /// @notice Request a withdrawal if withdrawalDelay is nonzero
    /// @dev This is required to prevent users from frontrunning slashing
    function requestWithdrawal() external {
        require(withdrawalDelay > 0, "StakingModule: Withdrawal delay is 0");
        require(block.timestamp > withdrawalRequestTimestamps[msg.sender] + withdrawalDelay + withdrawalWindow, "StakingModule: Withdrawal already pending");

        withdrawalRequestTimestamps[msg.sender] = block.timestamp;
    }

    /// @notice Stakes some amount of TEL to earn potential rewards.
    /// @param amount Amount to stake
    function stake(uint256 amount) external nonReentrant {
        _stake({
            account: msg.sender, 
            from: msg.sender, 
            amount: amount
        });
    }

    function partialExit(uint256 amount) external nonReentrant delayedWithdrawal {
        _partialExit({
            account: msg.sender, 
            to: msg.sender, 
            exitAmount: amount
        });
    }

    /// @notice Withdraws staked TEL, does not claim any yield.
    /// @return Amount withdrawn
    function exit() external nonReentrant delayedWithdrawal returns (uint256) {
        return _exit({
            account: msg.sender, 
            to: msg.sender
        });
    }

    /// @notice Claims yield from an individual plugin and sends it to calling account.
    /// @param pluginAddress Address of desired plugin
    /// @param auxData Auxiliary data for the plugin
    /// @return Amount claimed
    function claimFromIndividualPlugin(address pluginAddress, bytes calldata auxData) external nonReentrant delayedWithdrawal returns (uint256) {
        return _claimFromIndividualPlugin({
            account: msg.sender, 
            to: msg.sender, 
            pluginAddress: pluginAddress, 
            auxData: auxData
        });
    }

    /// @notice Claims yield from all plugins and sends it to calling account.
    /// @param auxData Auxiliary data for the plugins
    /// @return Amount claimed
    function claim(bytes calldata auxData) external nonReentrant delayedWithdrawal returns (uint256) {
        return _claim({
            account: msg.sender, 
            to: msg.sender, 
            auxData: auxData
        });
    }

    /// @notice Claims all yield and withdraws all stake.
    /// @param auxData Auxiliary data for the plugins
    /// @return Amount claimed
    /// @return Amount withdrawn
    function fullClaimAndExit(bytes calldata auxData) external nonReentrant delayedWithdrawal returns (uint256, uint256) {
        return (
            _claim({ account: msg.sender, to: msg.sender, auxData: auxData }), 
            _exit(msg.sender, msg.sender)
        );
    }

    /// @notice Claims yield and withdraws some of stake.
    /// @param amount Amount to withdraw
    /// @param auxData Auxiliary data for the plugins
    function partialClaimAndExit(uint256 amount, bytes calldata auxData) external nonReentrant delayedWithdrawal {
        _claimAndExit({
            account: msg.sender, 
            amount: amount, 
            to: msg.sender,
            auxData: auxData
        });
    }

    

    /************************************************
    *   private mutative functions
    ************************************************/

    /// @notice Claims earned yield from an individual plugin
    /// @param account Account to claim on behalf of.
    /// @param to Address to send the claimed yield to.
    /// @param pluginAddress Address of the desired plugin to claim from
    /// @dev Calls `claim` on the desired plugin
    /// @dev Checks to make sure the amount of tokens the plugins sent matches what the `claim` functions returned. (Probably unnecessary)
    /// @return Amount claimed
    function _claimFromIndividualPlugin(address account, address to, address pluginAddress, bytes calldata auxData) private returns (uint256) {
        require(pluginsMapping[pluginAddress], "StakingModule::_claimFromIndividualPlugin: Provided pluginAddress is invalid");
        
        // balance of `to` before claiming
        uint256 balBefore = IERC20Upgradeable(tel).balanceOf(to);

        // xClaimed = "amount of TEL claimed from the plugin"
        uint256 xClaimed = IPlugin(pluginAddress).claim(account, to, parseAuxData(auxData)[pluginIndicies[pluginAddress]]);

        // we want to make sure the plugin did not return the wrong amount
        require(IERC20Upgradeable(tel).balanceOf(to) - balBefore == xClaimed, "The plugin did not send appropriate token amount");

        // only emit Claimed if anything was actually claimed
        if (xClaimed > 0) {
            emit Claimed(account, xClaimed);
        }

        return xClaimed;
    }

    /// @notice Claims earned yield
    /// @param account Account to claim on behalf of.
    /// @param to Address to send the claimed yield to.
    /// @param auxData Auxiliary data for the plugins
    /// @dev Iterates over all plugins and calls `claim`
    /// @dev Checks to make sure the amount of tokens the plugins sent matches what the `claim` functions returned.
    /// @dev If amount claimed is >0, emit Claimed
    /// @return Amount claimed
    function _claim(address account, address to, bytes calldata auxData) private returns (uint256) {
        // balance of `to` before claiming
        uint256 balBefore = IERC20Upgradeable(tel).balanceOf(to);

        // call claim on all plugins and count the total amount claimed
        uint256 total;
        bytes[] memory parsedAuxData = parseAuxData(auxData);
        for (uint256 i = 0; i < nPlugins; i++) {
            try IPlugin(plugins[i]).claim(account, to, parsedAuxData[i]) returns (uint256 xClaimed) {
                total += xClaimed;
            } catch  {
                emit PluginClaimFailed(plugins[i]);
            }
        }

        // make sure `total` actually matches how much we've claimed
        require(IERC20Upgradeable(tel).balanceOf(to) - balBefore == total, "one or more plugins did not send appropriate token amount");

        // only emit Claimed if anything was actually claimed
        if (total > 0) {
            emit Claimed(account, total);
        }

        return total;
    }

    /// @notice Withdraws staked TEL to the specified `to` address, does not claim any yield.
    /// @dev Notifies all plugins that account's stake is changing.
    /// @dev Writes _stakes checkpoint. 
    /// @dev Decrements _totalStaked
    /// @dev Transfers TEL
    /// @dev Emits StakeChanged.
    /// @param account Account to exit on behalf of.
    /// @param to Address to send the withdrawn balance to.
    /// @return Amount withdrawn
    function _exit(address account, address to) private returns (uint256) {
        uint256 stakedAmt = _stakes[account].latest();

        _partialExit(account, to, stakedAmt);

        return stakedAmt;
    }

    function _partialExit(address account, address to, uint256 exitAmount) private checkpointProtection(account) {
        if (exitAmount == 0) {
            return;
        }

        uint256 stakedAmt = _stakes[account].latest();

        require(stakedAmt >= exitAmount, "StakingMoudle: Cannot exit more than is staked");

        // notify plugins
        _notifyStakeChangeAllPlugins(account, stakedAmt, stakedAmt - exitAmount);

        // update checkpoints
        _stakes[account].push(stakedAmt - exitAmount);

        // update _totalStaked
        _totalStaked -= exitAmount;

        // move the tokens
        IERC20Upgradeable(tel).safeTransfer(to, exitAmount);

        emit StakeChanged(account, stakedAmt, stakedAmt - exitAmount);
    }

    /// @notice Stakes some amount of TEL to earn potential rewards.
    /// @dev Notifies all plugins that account's stake is changing.
    /// @dev Updates _stakes[account]
    /// @dev Increments _totalStaked
    /// @dev Transfers TEL
    /// @dev Emits StakeChanged.
    /// @param account Account to stake on behalf of
    /// @param from Address to pull TEL from
    /// @param amount Amount to stake
    function _stake(address account, address from, uint256 amount) private {
        require(amount > 0, "Cannot stake 0");

        uint256 stakedBefore = _stakes[account].latest();
        uint256 stakedAfter = stakedBefore + amount;

        // notify plugins
        _notifyStakeChangeAllPlugins(account, stakedBefore, stakedAfter);
        
        // update _stakes
        _stakes[account].push(stakedAfter);

        // update _totalStaked
        _totalStaked += amount;

        // move the tokens
        IERC20Upgradeable(tel).safeTransferFrom(from, address(this), amount);

        emit StakeChanged(account, stakedBefore, stakedAfter);
    }

    /// @notice Claims yield and withdraws some of stake. Everything leftover remains staked
    /// @param account account
    /// @param amount amount to withdraw
    /// @param to account to send withdrawn funds to
    /// @dev The yield of the account is claimed to this contract
    /// @dev Call `notifyStakeChange` on all plugins
    /// @dev Update _stakes[account]
    /// @dev Update _totalStaked
    /// @dev Transfer `amount` of tokens to `to`
    /// @dev Emit StakeChanged
    function _claimAndExit(address account, uint256 amount, address to, bytes calldata auxData) private checkpointProtection(account) {
        require(amount <= balanceOf(account, auxData), "Account has insufficient balance");

        // keep track of initial stake
        uint256 oldStake = _stakes[account].latest();
        // xClaimed = total amount claimed
        uint256 xClaimed = _claim(account, address(this), auxData);

        uint256 newStake = oldStake + xClaimed - amount;

        // notify all plugins that account's stake has changed (if the plugin requires)
        _notifyStakeChangeAllPlugins(account, oldStake, newStake);

        // update _stakes
        _stakes[account].push(newStake);

        // decrement _totalStaked
        _totalStaked = _totalStaked - oldStake + newStake;

        // transfer the tokens to `to`
        IERC20Upgradeable(tel).safeTransfer(to, amount);

        emit StakeChanged(account, oldStake, newStake);
    }

    /// @dev Calls `notifyStakeChange` on all plugins that require it. This is done in case any given plugin needs to do some stuff when a user exits.
    /// @param account Account that is exiting
    function _notifyStakeChangeAllPlugins(address account, uint256 amountBefore, uint256 amountAfter) private {
        // loop over all plugins
        for (uint256 i = 0; i < nPlugins; i++) {
            // only notify if the plugin requires
            if (IPlugin(plugins[i]).requiresNotification()) {
                try IPlugin(plugins[i]).notifyStakeChange(account, amountBefore, amountAfter) {}
                catch {
                    emit StakeChangeNotificationFailed(plugins[i]);
                }
            }
        }
    }


    /************************************************
    *   restricted functions
    ************************************************/

    /// @notice Slashes stake of an account.
    /// @notice Only those holding the `SLASHER_ROLE` may call this.
    /// @param account account to slash
    /// @param amount amount to slash
    /// @param to account to send slashed funds to
    function slash(address account, uint amount, address to, bytes calldata auxData) external onlyRole(SLASHER_ROLE) nonReentrant {
        _claimAndExit(account, amount, to, auxData);
        emit Slashed(account, amount);
    }

    /// @notice Sets the withdrawal delay and window to prevent frontrunning slashes
    function setWithdrawDelayAndWindow(uint256 delay, uint256 window) external onlyRole(SLASHER_ROLE) {
        require(delay <= maxWithdrawalDelay, "StakingModule: Desired delay is too long");
        require(window >= minWithdrawalWindow, "StakingModule: Desired window is too short");

        // if window + delay is >= current time, then someone with a requestTimestamp of 0 will be able to withdraw (i.e. withdraw without requesting)
        // when requestTimestamp = 0, the following must hold: t > d + w
        require(window + delay < block.timestamp, "StakingModule: Desired window + delay is too large");

        withdrawalDelay = delay;
        withdrawalWindow = window;
    }

    /// @notice Adds a new plugin
    function addPlugin(address plugin) external onlyRole(PLUGIN_EDITOR_ROLE) {
        require(!IPlugin(plugin).deactivated(), "StakingModule::addPlugin: Cannot add deactivated plugin");
        require(IERC165(plugin).supportsInterface(type(IPlugin).interfaceId), "StakingModule::addPlugin: plugin does not support IPlugin");
        require(!pluginsMapping[plugin], "StakingModule::addPlugin: Cannot add an existing plugin");

        plugins.push(plugin);
        pluginsMapping[plugin] = true;
        pluginIndicies[plugin] = nPlugins;
        nPlugins++;

        emit PluginAdded(plugin, nPlugins);
    }

    /// @notice Removes a plugin
    function removePlugin(uint256 index) external onlyRole(PLUGIN_EDITOR_ROLE) {
        address plugin = plugins[index];

        require(IPlugin(plugin).deactivated(), "StakingModule::removePlugin: Plugin is not deactivated");

        pluginsMapping[plugin] = false;
        plugins[index] = plugins[nPlugins - 1];
        pluginIndicies[plugins[index]] = index;
        plugins.pop();
        nPlugins--;

        emit PluginRemoved(plugin, nPlugins);
    }

    /// @notice rescues any stuck erc20
    /// @dev if the token is TEL, then it only allows maximum of balanceOf(this) - _totalStaked to be rescued
    function rescueTokens(IERC20Upgradeable token, address to) external onlyRole(RECOVERY_ROLE) {
        if (address(token) == tel) {
            // if the token is TEL, only remove the extra amount that isn't staked
            token.safeTransfer(to, token.balanceOf(address(this)) - _totalStaked);
        }
        else {
            // if the token isn't TEL, remove all of it
            token.safeTransfer(to, token.balanceOf(address(this)));
        }
    }

    /// @notice claim and exit on behalf of a user
    /// @dev This function is in case of a token migration
    /// @dev We know this would be insanely gas intensive if there are a lot of users
    function claimAndExitFor(address account, address to, bytes calldata auxData) external onlyRole(MIGRATOR_ROLE) nonReentrant returns (uint256, uint256) {
        return (_claim(account, to, auxData), _exit(account, to));
    }

    /// @notice stake on behalf of a user
    /// @dev This function is in case of a token migration
    /// @dev We know this would be insanely gas intensive if there are a lot of users
    function stakeFor(address account, uint256 amount) external onlyRole(MIGRATOR_ROLE) nonReentrant {
        _stake(account, msg.sender, amount);
    }
}
