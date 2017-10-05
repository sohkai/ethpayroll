pragma solidity ^0.4.11;

import "../../ERC23/contracts/implementation/Standard23Token.sol";


contract MockToken is Standard23Token {
  function addBalance(uint256 balance) {
    balances[msg.sender] += balance;
    totalSupply += balance;
  }
}
