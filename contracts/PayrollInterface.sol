pragma solidity ^0.4.11;


// For the sake of simplicity lets assume USD is a ERC20 token
// Also lets assume we can 100% trust the exchange rate oracle
contract PayrollInterface {
  /* OWNER ONLY */
  function addEmployee(address accountAddress, address[] allowedTokens, uint256 initialYearlyUSDSalary) external returns (uint256);
  function setEmployeeAllowedToken(uint256 employeeId, address token, bool allowed) external;
  function setEmployeeSalary(uint256 employeeId, uint256 yearlyUSDSalary) external;
  function removeEmployee(uint256 employeeId) external;

  function addFunds() external payable;
  function scapeHatch() external;
  // function addTokenFunds()? // Use approveAndCall or ERC223 tokenFallback

  function getEmployeeCount() external constant returns (uint256);
  function getEmployee(uint256 employeeId) external constant returns (address employeeAccount, bool active, uint256 lastPayDate, uint256 lastAllocationDate, uint256 yearlyUsdSalary); // Return all important info too

  function calculatePayrollBurnrate() constant returns (uint256); // Monthly usd amount spent in salaries
  function calculatePayrollRunway() constant returns (uint256); // Days until the contract can run out of funds

  /* EMPLOYEE ONLY */
  function determineAllocation(address[] tokens, uint256[] distribution) external; // only callable once every 6 months
  function payday() external; // only callable once a month

  /* ORACLE ONLY */
  function setExchangeRate(address token, uint256 usdExchangeRate) external; // uses decimals from token
}
