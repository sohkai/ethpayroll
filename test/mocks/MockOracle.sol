pragma solidity ^0.4.11;

import "../../contracts/PayrollInterface.sol";


contract MockOracle {
  function setRate(address payroll, address token, uint256 exchangeRate) {
    PayrollInterface(payroll).setExchangeRate(token, exchangeRate);
  }
}
