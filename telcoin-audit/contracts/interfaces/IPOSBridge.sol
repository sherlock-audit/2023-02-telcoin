// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IPOSBridge {
  function depositEtherFor(address user) external payable;
  function depositFor(address user, address rootToken, bytes calldata depositData) external;
}