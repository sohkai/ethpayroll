pragma solidity ^0.4.11;

import "zeppelin/math/SafeMath.sol";
import "zeppelin/lifecycle/Pausable.sol";
import "zeppelin/token/ERC20Basic.sol";
import "./PayrollInterface.sol";


contract Payroll is PayrollInterface, Pausable {
  using SafeMath for uint256; // Note that I've avoided using .div() as it's superfluous

  struct Employee {
    address account;
    bool active;
    mapping(address => bool) allowedTokens;
    uint256 lastAllocationDate;
    uint256 lastPayDate;
    TokenDistribution[] tokenDistribution;
    uint256 yearlyUsdSalary; // Math in Solidity is kind of a b****, I'd suggest changing this to weekly salary or etc instead
  }

  struct TokenDistribution {
    address token;
    uint256 distribution; // As a percentage
  }

  // Employees
  uint256 activeEmployeeCount = 0;
  uint256 terminatedEmployeeCount = 0;
  mapping(uint256 => Employee) employees;
  mapping(address => uint256) employeeIds;

  // Accounting
  // Let's assume that both ETH and USD are implemented as tokens, and that we can get their
  // exchange rates via their token address.
  // However, for ETH, let's still assume current ETH functionality as a native asset
  // (e.g. addr.transfer() sends ETH, contracts hold their own ETH via this.balance, etc)
  uint runwayLimit = 365;
  address ethToken;
  address usdToken;
  mapping(address => uint256) tokenUsdBurnRates; // As yearly rate

  // Oracle
  // Let's assume we can fully trust the oracle, and that we can configure it to give us any
  // USD/token pair's exchange rate (as tokens/1 USD). Let's also assume that the oracle immediately
  // gives us exchange rates upon this contract's creation, so that all watched tokens have an
  // explicit exchange rate.
  // However, this oracle will never report on a USD/USD pair, so we'll have to add it in to the
  // contract's state ourselves.
  address exchangeOracle;
  address[] watchedTokens;
  mapping(address => uint256) usdExchangeRates;

  /**
   * @dev Constructor.
   * @param _exchangeOracle address Address of the exchange oracle.
   * @param _ethToken address Address of the ETH token contract.
   * @param _usdToken address Address of the USD token contract.
   */
  function Payroll(address _exchangeOracle, address _ethToken, address _usdToken) {
    exchangeOracle = _exchangeOracle;
    ethToken = _ethToken;
    usdToken = _usdToken;

    // Add USD to our watch list and set implicit 1:1 exchange rate
    watchedTokens.push(usdToken);
    usdExchangeRates[usdToken] = 1;
  }

  /* OWNER ONLY */
  /**
   * @dev Add new employee.
   * @param accountAddress address Address of the employee's account.
   * @param allowedTokens address[] Allowed tokens for employee salary allocation.
   * @param initialYearlyUsdSalary uint256 Initial yearly salary (USD).
   * @return uint256 New employee id.
   */
  function addEmployee(address accountAddress, address[] allowedTokens, uint256 initialYearlyUsdSalary)
    external
    onlyOwner
    whenNotPaused
    returns (uint256 newEmployeeId)
  {
    require(accountAddress != address(0));
    // Make sure that this account isn't already an employee
    require(employeeIds[accountAddress] == 0);

    activeEmployeeCount = activeEmployeeCount.add(1);
    newEmployeeId = activeEmployeeCount.add(terminatedEmployeeCount);
    employeeIds[accountAddress] = newEmployeeId;

    Employee storage newEmployee = employees[newEmployeeId];
    newEmployee.account = accountAddress;
    newEmployee.active = true;
    newEmployee.yearlyUsdSalary = initialYearlyUsdSalary;

    // Add allowed tokens, and always allow ETH and USD
    for (uint256 token = 0; token < allowedTokens.length; ++token) {
      newEmployee.allowedTokens[allowedTokens[token]] = true;
    }
    newEmployee.allowedTokens[ethToken] = true;
    newEmployee.allowedTokens[usdToken] = true;

    // Set default token distribution to be 100% USD and add to burn rate
    newEmployee.tokenDistribution.push(TokenDistribution(usdToken, 100));
    modifyEmployeeDistributionOnBurnRate(newEmployee, SafeMath.add);

    // Set the employee's paydays to be synced with their addition date, but let them set their
    // token allocation once for free
    newEmployee.lastPayDate = now;

    LogEmployeeAdded(newEmployeeId, accountAddress, allowedTokens, initialYearlyUsdSalary);
  }

  /**
   * @dev Change allowed tokens for employee.
   *      Only usable every six months (26 weeks) in line with the last allocation date (and must be
   *      called before a new allocation is assigned to the employee).
   * @param employeeId uint256 Employee id.
   * @param token address Token to change.
   * @param allowed bool Is the token allowed to be allocated by the employee?
   */
  function setEmployeeAllowedToken(uint256 employeeId, address token, bool allowed)
    external
    onlyOwner
    onlyOnActiveEmployee(employeeId)
    whenNotPaused
  {
    Employee storage employee = employees[employeeId];
    require(isAfterPeriod(26 weeks, employee.lastAllocationDate)); // Only every half year

    employee.allowedTokens[token] = allowed;

    LogEmployeeAllowedTokenSet(employeeId, token, allowed);
  }

  /**
   * @dev Change employee's yearly salary (USD).
   * @param employeeId uint256 Employee id.
   * @param yearlyUsdSalary uint256 Yearly salary.
   */
  function setEmployeeSalary(uint256 employeeId, uint256 yearlyUsdSalary)
    external
    onlyOwner
    onlyOnActiveEmployee(employeeId)
    whenNotPaused
  {
    Employee storage employee = employees[employeeId];
    uint256 oldSalary = employee.yearlyUsdSalary;

    // Remove the old salary's impact on corporate burn rate
    modifyEmployeeDistributionOnBurnRate(employee, SafeMath.sub);

    employee.yearlyUsdSalary = yearlyUsdSalary;

    // Add the new salary's impact on corporate burn rate
    modifyEmployeeDistributionOnBurnRate(employee, SafeMath.add);

    LogEmployeeSalarySet(employeeId, oldSalary, yearlyUsdSalary);
  }

  /**
   * @dev Remove employee (by termination; employee records are still kept).
   * @param employeeId uint256 Employee id.
   */
  function removeEmployee(uint256 employeeId)
    external
    onlyOwner
    onlyOnActiveEmployee(employeeId)
    whenNotPaused
  {
    employees[employeeId].active = false;
    activeEmployeeCount = activeEmployeeCount.sub(1);
    terminatedEmployeeCount = terminatedEmployeeCount.add(1);

    // Remove this employee's impact on corporate burn rate
    modifyEmployeeDistributionOnBurnRate(employees[employeeId], SafeMath.sub);

    LogEmployeeRemoved(employeeId);
  }

  /**
   * @dev Add ETH funds to contract.
   *      Contract is limited to only one year of funds at any time to avoid putting too much into
   *      the honeypot.
   */
  function addFunds() external payable whenNotPaused {
    // Limit contract funding to max of one year
    require(calculatePayrollRunway() <= 365);

    LogFundsAdded(msg.value);
  }

  // function addTokenFunds()? // Use approveAndCall or ERC223 tokenFallback

  /**
   * @dev Only when paused by the owner, as a fallback mechanism. Allows owner to transfer all held
   *      funds back to themselves.
   */
  function scapeHatch() external whenPaused {
    // Transfer non-ETH tokens
    for (uint256 token = 0; token < watchedTokens.length; ++token) {
      ERC20Basic tokenContract = ERC20Basic(watchedTokens[token]);
      uint256 balance = tokenContract.balanceOf(this);

      if (balance > 0) {
        tokenContract.transfer(owner, balance);
      }
    }

    // Finally, transfer ETH
    owner.transfer(this.balance);
  }

  /**
   * @dev Change exchange rate oracle.
   * @param _exchangeOracle address Address of exchange rate oracle.
   */
  function setExchangeOracle(address _exchangeOracle) external onlyOwner whenNotPaused {
    exchangeOracle = _exchangeOracle;
  }

  /**
   * @dev Change runway limit.
   * @param _runwayLimit uint256 Runway limit in days.
   */
  function setRunwayLimit(uint256 _runwayLimit) external onlyOwner whenNotPaused {
    runwayLimit = _runwayLimit;
    LogRunwayLimitSet(runwayLimit);
  }

  /**
   * @dev Get active employee count.
   * @return uint256 Number of active employees.
   */
  function getEmployeeCount() external constant returns (uint256) {
    return activeEmployeeCount;
  }

  /**
   * @dev Get employee.
   * @param employeeId uint256 Employee id.
   * @return multiple properties of the employee:
   *           * address employeeAccount
   *           * bool active
   *           * uint256 lastPayDate
   *           * uint256 lastAllocationDate
   *           * uint256 yearlyUsdSalary
   */
  function getEmployee(uint256 employeeId)
    external
    constant
    returns (
      address employeeAccount,
      bool active,
      uint256 lastPayDate,
      uint256 lastAllocationDate,
      uint256 yearlyUsdSalary
    )
  {
    require(employeeId != 0 && employeeId <= activeEmployeeCount.add(terminatedEmployeeCount));

    Employee storage employee = employees[employeeId];
    employeeAccount = employee.account;
    active = employee.active;
    lastPayDate = employee.lastPayDate;
    lastAllocationDate = employee.lastAllocationDate;
    yearlyUsdSalary = employee.yearlyUsdSalary;
  }

  /**
   * @dev Calculate monthly burn rate (USD).
   * @return uint256 Monthly burn rate (USD).
   */
  function calculatePayrollBurnrate() constant onlyOwner returns (uint256) {
    uint256 totalBurnRate = 0;
    for (uint256 token = 0; token < watchedTokens.length; ++token) {
      totalBurnRate = totalBurnRate.add(tokenUsdBurnRates[watchedTokens[token]]);
    }

    return totalBurnRate * 4 weeks / 1 years; // ~13 months/year for 4 week "months"
  }

  /**
   * @dev Calculate days left runway.
   * @return uint256 Days left until the contract can't pay salaries.
   */
  function calculatePayrollRunway() constant onlyOwner returns (uint256) {
      uint256 currentBurnRate = calculatePayrollBurnrate();

      if (currentBurnRate == 0) {
        // If we don't have a burn rate, let's say we're good until the the end of time
        return uint256(-1);
      }

      return this.balance / usdExchangeRates[ethToken] * 4 weeks / 1 days / currentBurnRate; // USD per day
  }

  /* EMPLOYEE ONLY */
  /**
   * @dev Set the salary allocation of the employee sending the request.
   *      Note that each token must be allowed for the employee and the distribution must sum to 100.
   *      Only usable every six months (26 weeks).
   * @param tokens address[] Array of token addresses to allocate.
   * @param distribution uint256[] Array of distributions, in percentages, for each matching token.
   */
  function determineAllocation(address[] tokens, uint256[] distribution)
    external
    onlyActiveEmployee
    whenNotPaused
  {
    address[] memory allocTokens;
    uint256[] memory allocDistribution;
    uint256 curDistribution;
    address curToken;
    uint256 totalDistribution = 0;
    uint256 employeeId = employeeIds[msg.sender];
    Employee storage employee = employees[employeeId];

    require(isAfterPeriod(26 weeks, employee.lastAllocationDate)); // Only every half year
    require(tokens.length == distribution.length);

    employee.lastAllocationDate = now;

    // Reset this employee's distribution and its effect on corporate burn rate
    modifyEmployeeDistributionOnBurnRate(employee, SafeMath.sub);
    delete employee.tokenDistribution;

    if (tokens.length == 0) {
      // If no allocation is given, assume employee wants all of their pay in USD
      allocTokens = new address[](1);
      allocDistribution = new uint256[](1);
      allocTokens[0] = usdToken;
      allocDistribution[0] = 100;
    } else {
      allocTokens = tokens;
      allocDistribution = distribution;
    }

    // Set up the new allocation and add its effect on burn rate
    // Do some sanity checking at this stage to avoid an extra initial pass through the given arrays
    for (uint256 token = 0; token < allocTokens.length; ++token) {
      curDistribution = allocDistribution[token];
      curToken = allocTokens[token];

      // Ignore any declared distributions that are 0
      if (curDistribution == 0) {
        continue;
      }

      require(employee.allowedTokens[curToken]);
      // Require allocated tokens to be provided an exchange rate by the oracle
      require(usdExchangeRates[curToken] != 0);

      employee.tokenDistribution.push(TokenDistribution(curToken, curDistribution));
      totalDistribution = totalDistribution.add(curDistribution);
    }
    modifyEmployeeDistributionOnBurnRate(employee, SafeMath.add);
    require(totalDistribution == 100);

    LogEmployeeDistributionSet(employeeId);
  }

  /**
   * @dev Pay last month's owed wages for the employee sending the request.
   */
  function payday() external onlyActiveEmployee whenNotPaused {
    uint256 owedTokens;
    uint256 employeeId = employeeIds[msg.sender];
    Employee storage employee = employees[employeeId];

    require(isAfterPeriod(4 weeks, employee.lastPayDate));

    employee.lastPayDate = now;

    TokenDistribution[] storage tokenDistribution = employee.tokenDistribution;
    for (uint256 token = 0; token < tokenDistribution.length; ++token) {
      address tokenAddress = tokenDistribution[token].token;
      // The math here is probably going to be pretty crappy unless we're using super high values
      // (e.g. accuracy up to millionth of a cent)
      owedTokens = usdExchangeRates[tokenAddress].mul(employee.yearlyUsdSalary).mul(tokenDistribution[token].distribution);
      owedTokens = owedTokens * 4 weeks / 1 years; // Get monthly (we have ~13 months/year due to 4 week "months")
      owedTokens /= 100; // Distribution unit is percent

      // Send the token
      // NOTE: Assuming every allowed token (including USD and ETH) is an ERC20 token that keeps
      // its balance sheet in storage, there shouldn't be a problem with inconsistent balances if
      // this function runs out of gas / errors (it'll revert all the transfers too).
      // I've avoided using the PullPayment pattern under this assumption.
      //
      // With ERC23 token callbacks though, I'm not too sure about re-entrancy when sending
      // tokens. Maybe the safest approach would still be to use a withdrawl pattern for each
      // allocated token?
      require(ERC20Basic(tokenAddress).transfer(msg.sender, owedTokens));
    }

    LogEmployeePaid(employeeId);
  }

  /* ORACLE ONLY */
  /**
   * @dev Set the exchange rate of a token. Only callable from the attached oracle.
   * @param token address Address of the token
   * @param usdExchangeRate uint256 Exchange rate of the token to USD (tokens / USD)
   */
  function setExchangeRate(address token, uint256 usdExchangeRate) external onlyOracle {
    if (usdExchangeRates[token] == 0) {
        watchedTokens.push(token);
    }
    usdExchangeRates[token] = usdExchangeRate;
  }

  /* INTERNAL */
  /**
   * @dev Checks if it's past a given period since a date.
   * @param period uint256 Period of time.
   * @param since uint256 Start date.
   * @return bool Currently after the period?
   */
  function isAfterPeriod(uint256 period, uint256 since) internal constant returns (bool) {
    return now.sub(since) > period;
  }

  /**
   * @dev Modify the burn rate based on the given employee and function.
   * @param employee Employee Employee.
   * @param func function Function to modify current burn rate with each allocated token of the
   *                      employee. Designed for use with SafeMath's utils
   *                      (ie. uint256, uint256 => uint256)
   */
  function modifyEmployeeDistributionOnBurnRate(
      Employee storage employee,
      function (uint256, uint256) constant returns (uint256) func
  ) internal {
    TokenDistribution[] storage tokenDistribution = employee.tokenDistribution;

    for (uint256 allocToken = 0; allocToken < tokenDistribution.length; ++allocToken) {
      uint256 distribution = tokenDistribution[allocToken].distribution;
      address token = tokenDistribution[allocToken].token;
      tokenUsdBurnRates[token] = func(tokenUsdBurnRates[token],
                                      (distribution.mul(employee.yearlyUsdSalary) / 100));
    }
  }

  /* MODIFIERS */
  modifier onlyActiveEmployee() {
    require(employees[employeeIds[msg.sender]].active);
    _;
  }

  modifier onlyOnActiveEmployee(uint256 employeeId) {
    require(employees[employeeId].active);
    _;
  }

  modifier onlyOracle() {
    require(msg.sender == exchangeOracle);
    _;
  }

  event LogEmployeeAdded(uint256 indexed id, address account, address[] allowedTokens, uint256 initialYearlyUsdSalary);
  event LogEmployeeAllowedTokenSet(uint256 indexed id, address token, bool allowed);
  event LogEmployeeDistributionSet(uint256 indexed id);
  event LogEmployeePaid(uint256 indexed id);
  event LogEmployeeRemoved(uint256 indexed id);
  event LogEmployeeSalarySet(uint256 indexed id, uint256 oldSalary, uint256 newSalary);
  event LogFundsAdded(uint256 amount);
  event LogRunwayLimitSet(uint256 runway);
  event LogUsdExchangeRateSet(address indexed token, uint256 exchangeRate);
}
