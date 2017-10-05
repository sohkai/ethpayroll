pragma solidity ^0.4.11;

import "../../contracts/Payroll.sol";


contract MockPayroll is Payroll {
  function getExchangeOracle() constant returns (address) {
    return exchangeOracle;
  }

  function getRunwayLimit() constant returns (uint256) {
    return runwayLimit;
  }

  function getEmployeeTokenDistribution(uint256 employeeId, uint256 index)
    constant
    returns (address token, uint256 distribution)
  {
    TokenDistribution storage tokenDistribution = employees[employeeId].tokenDistribution[index];
    token = tokenDistribution.token;
    distribution = tokenDistribution.distribution;
  }

  function getEmployeeTokenAllowed(uint256 employeeId, address token) constant returns (bool) {
    return employees[employeeId].allowedTokens[token];
  }

  function setEmployeePayDate(uint256 employeeId, uint256 date) {
    employees[employeeId].lastPayDate = date;
  }

  function setEmployeeAllocationDate(uint256 employeeId, uint256 date) {
    employees[employeeId].lastAllocationDate = date;
  }
}
