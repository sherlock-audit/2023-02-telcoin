// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IPlugin.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract TestPlugin is IPlugin {
    uint256 numAns;
    bool bAns;

    bool shouldRevert;

    function claim(
        address account,
        address to,
        bytes calldata auxData
    ) external override returns (uint256) {
        require(!shouldRevert);
        return numAns;
    }

    function claimable(address account, bytes calldata auxData)
        external
        view
        override
        returns (uint256)
    {
        return numAns;
    }

    function totalClaimable() external view override returns (uint256) {
        return numAns;
    }

    function claimableAt(
        address account,
        uint256 blockNumber,
        bytes calldata auxData
    ) external view override returns (uint256) {
        return numAns;
    }

    function notifyStakeChange(
        address account,
        uint256 amountBefore,
        uint256 amountAfter
    ) external override {
        require(!shouldRevert);
    }

    function supportsInterface(bytes4) public view virtual override returns (bool) {
        return !shouldRevert;
    }

    function requiresNotification() external view override returns (bool) {
        return bAns;
    }

    function deactivated() external view override returns (bool) {
        return bAns;
    }

    function setBAns(bool x) public {
        bAns = x;
    }

    function setNumAns(uint256 x) public {
        numAns = x;
    }

    function setShouldRevert(bool x) public {
        shouldRevert = x;
    }
}