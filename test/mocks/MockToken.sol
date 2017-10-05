pragma solidity ^0.4.11;

// import "../../ERC23/contracts/implementation/Standard23Token.sol";
import "zeppelin/token/StandardToken.sol";


contract MockToken is /*Standard23Token*/ StandardToken {
  function addBalance(uint256 balance) {
    balances[msg.sender] += balance;
    totalSupply += balance;
  }
}
