/* global it beforeEach assert web3 artifacts contract */
import assertJump from "./helpers/assertJump.js";

const MockOracle = artifacts.require("./mocks/MockOracle.sol");
const MockToken = artifacts.require("./mocks/MockToken.sol");

/*************************************************************************
 *                                                                       *
 *                         ***     NOTE     ***                          *
 *                                                                       *
 * Using MockPayroll results in gas limit errors with truffle, so I've   *
 * commented out some of the tests that require the additional methods   *
 * provided by the mock (Mocha doesn't seem to let you mark tests as     *
 * failing (as in say, pytest).                                          *
 *                                                                       *
 ************************************************************************/
// const MockPayroll = artifacts.require("./mocks/MockPayroll.sol");
const Payroll = artifacts.require("../contracts/Payroll.sol");

const BASE_ETH_USD_EXCHANGE_RATE = 50;
const BASE_BTC_USD_EXCHANGE_RATE = 100;
const BASE_ANT_USD_EXCHANGE_RATE = 5;

contract("Payroll", (accounts) => {
  const OWNER = accounts[0];
  const EMPLOYEE_1 = accounts[1];
  const EMPLOYEE_2 = accounts[2];
  const EMPLOYEE_3 = accounts[3];
  const EMPLOYEE_1_ID = 1;
  const EMPLOYEE_2_ID = 2; // eslint-disable-line no-unused-vars
  const EMPLOYEE_3_ID = 3; // eslint-disable-line no-unused-vars

  let oracle;
  let usd;
  let eth;
  let btc;
  let ant;
  let payroll;

  beforeEach(async () => {
    oracle = await MockOracle.new();
    usd = await MockToken.new();
    eth = await MockToken.new();
    btc = await MockToken.new();
    ant = await MockToken.new();
    // payroll = await MockPayroll.new(oracle.address, eth.address, usd.address);
    payroll = await Payroll.new(oracle.address, eth.address, usd.address);

    // Set up base exchange rates
    await oracle.setRate(payroll.address, eth.address, BASE_ETH_USD_EXCHANGE_RATE);
    await oracle.setRate(payroll.address, btc.address, BASE_BTC_USD_EXCHANGE_RATE);
    await oracle.setRate(payroll.address, ant.address, BASE_ANT_USD_EXCHANGE_RATE);

    // Add some fake token balances to our owner account; ETH will be handled natively
    await usd.addBalance(1000000000);
    await btc.addBalance(1000000000);
    await ant.addBalance(1000000000);
  });

  it("should have no employees on creation", async () => {
    const numEmployees = await payroll.getEmployeeCount();

    assert.equal(numEmployees, 0);
  });

  it("should have no burn rate on creation", async () => {
    const burnRate = await payroll.calculatePayrollBurnrate();

    assert.equal(burnRate, 0);
  });

  it("should have an endless runway on creation", async () => {
    const END_OF_TIME = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    const runway = await payroll.calculatePayrollRunway();

    assert.equal(runway.toNumber(), END_OF_TIME);
  });

  it("should add new employees", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);
    let numEmployees = await payroll.getEmployeeCount();
    assert.equal(numEmployees, 1);

    await payroll.addEmployee(EMPLOYEE_2, [], 150000);
    numEmployees = await payroll.getEmployeeCount();
    assert.equal(numEmployees, 2);
  });

  it("should get an employee", async () => {
    const SALARY = 150000;
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    const [account, active, lastPayDate, lastAllocationDate, yearlySalary] = await payroll.getEmployee(EMPLOYEE_1_ID);

    assert.equal(account, EMPLOYEE_1);
    assert.isTrue(active);
    assert.isAbove(lastPayDate, 0); // Should be sometime around now
    assert.equal(lastAllocationDate, 0); // Should be unset at first
    assert.equal(yearlySalary, SALARY);
  });

  /*
  it("should set a new allowed token on an employee", async () => {
    const bcc = await MockToken.new();
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);
    await payroll.setEmployeeAllocationDate(EMPLOYEE_1, 0);

    let allowed = await payroll.getEmployeeTokenAllowed(EMPLOYEE_1_ID, bcc.address);
    assert.isFalse(allowed);

    await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, bcc.address, true);
    allowed = await payroll.getEmployeeTokenAllowed(EMPLOYEE_1_ID, bcc.address);
    assert.isTrue(allowed);
  });
  */

  /*
  it("should remove an allowed token from an employee", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);
    await payroll.setEmployeeAllocationDate(EMPLOYEE_1, 0);

    let allowed = await payroll.getEmployeeTokenAllowed(EMPLOYEE_1_ID, btc.address);
    assert.isTrue(allowed);

    await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, btc.address, false);
    allowed = await payroll.getEmployeeTokenAllowed(EMPLOYEE_1_ID, btc.address);
    assert.isFalse(allowed);
  });
  */

  it("should not change allowed tokens on an employee if too soon", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);
    // Set allocation so we shouldn't be able to change the allowed tokens for 6 months
    await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });

    try {
      await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, btc.address, false);
      assert.fail("should have thrown on setting allowed token");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should set a new salary for an employee", async () => {
    const NEW_SALARY = 200000;
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    // eslint-disable-next-line no-unused-vars
    let [account, active, lastPayDate, lastAllocationDate, yearlySalary] = await payroll.getEmployee(EMPLOYEE_1_ID);
    assert.notEqual(NEW_SALARY, yearlySalary);

    await payroll.setEmployeeSalary(EMPLOYEE_1_ID, NEW_SALARY);
    [account, active, lastPayDate, lastAllocationDate, yearlySalary] = await payroll.getEmployee(EMPLOYEE_1_ID);
    assert.equal(NEW_SALARY, yearlySalary);
  });

  it("should terminate an employee", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    const prevEmployeeNum = await payroll.getEmployeeCount();
    assert.equal(prevEmployeeNum, 1);

    await payroll.removeEmployee(EMPLOYEE_1_ID);
    const afterEmployeeNum = await payroll.getEmployeeCount();
    // eslint-disable-next-line no-unused-vars
    const [account, active, lastPayDate, lastAllocationDate, yearlySalary] = await payroll.getEmployee(EMPLOYEE_1_ID);
    assert.equal(afterEmployeeNum, 0);
    assert.isFalse(active);
  });

  it("should allow new employees to be added after terminating", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    await payroll.removeEmployee(EMPLOYEE_1_ID);
    await payroll.addEmployee(EMPLOYEE_2, [btc.address, ant.address], 150000);

    const employeeNum = await payroll.getEmployeeCount();
    assert.equal(employeeNum, 1);
  });

  it("should allow funds to be added", async () => {
    const FUNDS_ADDED = 500;
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);

    await payroll.addFunds({ value: FUNDS_ADDED });
    assert.equal(FUNDS_ADDED, web3.eth.getBalance(payroll.address).toNumber());
  });

  it("should allow funds to be added when there's no employees", async () => {
    const FUNDS_ADDED = 500;

    await payroll.addFunds({ value: FUNDS_ADDED });
    assert.equal(FUNDS_ADDED, web3.eth.getBalance(payroll.address).toNumber());
  });

  it("should allow more funding by increasing the runway limit", async () => {
    const EMPLOYEE_SALARY = 36500;
    const FUNDS_ADDED = EMPLOYEE_SALARY * BASE_ETH_USD_EXCHANGE_RATE; // 365 days
    await payroll.addEmployee(EMPLOYEE_1, [], EMPLOYEE_SALARY);
    await payroll.addFunds({ value: FUNDS_ADDED });

    // Adding more should fail right now
    try {
      await payroll.addFunds({ value: FUNDS_ADDED / 2 });
      assert.fail("should have thrown on sending too much");
    } catch (error) {
      assertJump(error);
    }

    await payroll.setRunwayLimit(700);
    await payroll.addFunds({ value: FUNDS_ADDED / 2 });
  });

  it("should not allow funds to be added if the runway limit is passed", async () => {
    const EMPLOYEE_SALARY = 36500;
    const FUNDS_ADDED = (EMPLOYEE_SALARY + 100) * BASE_ETH_USD_EXCHANGE_RATE; // 366 days
    await payroll.addEmployee(EMPLOYEE_1, [], EMPLOYEE_SALARY);

    try {
      await payroll.addFunds({ value: FUNDS_ADDED });
      assert.fail("should have thrown on sending too much");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should allow token funds to be added", async () => {
    const FUNDS_ADDED = 500;
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);

    await btc.transfer(payroll.address, FUNDS_ADDED);
    const payrollBtcHolding = await btc.balanceOf(payroll.address);
    assert.equal(FUNDS_ADDED, payrollBtcHolding);
  });

  it("should allow token funds to be added when there's no employees", async () => {
    const FUNDS_ADDED = 500;

    await btc.transfer(payroll.address, FUNDS_ADDED);
    const payrollBtcHolding = await btc.balanceOf(payroll.address);
    assert.equal(FUNDS_ADDED, payrollBtcHolding);
  });

  it("should allow more token funding by increasing the runway limit", async () => {
    const EMPLOYEE_SALARY = 36500;
    const FUNDS_ADDED = EMPLOYEE_SALARY * BASE_BTC_USD_EXCHANGE_RATE; // 365 days
    await payroll.addEmployee(EMPLOYEE_1, [], EMPLOYEE_SALARY);
    await btc.transfer(payroll.address, FUNDS_ADDED);

    // Adding more should fail right now
    try {
      await btc.transfer(payroll.address, FUNDS_ADDED);
      assert.fail("should have thrown on sending too much");
    } catch (error) {
      assertJump(error);
    }

    await payroll.setRunwayLimit(700);
    await btc.transfer(payroll.address, FUNDS_ADDED);
  });

  it("should not allow token funds to be added if the runway limit is passed", async () => {
    const EMPLOYEE_SALARY = 36500;
    const FUNDS_ADDED = (EMPLOYEE_SALARY + 100) * BASE_BTC_USD_EXCHANGE_RATE; // 366 days
    await payroll.addEmployee(EMPLOYEE_1, [], EMPLOYEE_SALARY);

    try {
      await btc.transfer(payroll.address, FUNDS_ADDED);
      assert.fail("should have thrown on sending too much");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should calculate burn rate based on all employees", async () => {
    const SALARY = 52000;
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await payroll.addEmployee(EMPLOYEE_2, [], SALARY);
    await payroll.addEmployee(EMPLOYEE_3, [], SALARY);

    const burnRate = await payroll.calculatePayrollBurnrate();
    // calculatePayrollBurnrate() gives us a USD figure for 4-weeks
    // Due to internal EVM truncation, let's allow the figure some wiggle room
    assert.equal(Math.floor(SALARY * 3 / (365 / 28)), burnRate.toNumber());
  });

  it("should update burn rate after adding employee", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 500);
    const prevBurnRate = await payroll.calculatePayrollBurnrate();

    await payroll.addEmployee(EMPLOYEE_2, [], 500);
    const newBurnRate = await payroll.calculatePayrollBurnrate();
    assert.isAbove(newBurnRate.toNumber(), prevBurnRate.toNumber());
  });

  it("should update burn rate after changing employee salary", async () => {
    const SALARY = 500;
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    const prevBurnRate = await payroll.calculatePayrollBurnrate();

    await payroll.setEmployeeSalary(EMPLOYEE_1_ID, SALARY * 2);
    const newBurnRate = await payroll.calculatePayrollBurnrate();
    assert.isAbove(newBurnRate.toNumber(), prevBurnRate.toNumber());
  });

  it("should update burn rate after removing employee", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 500);
    await payroll.addEmployee(EMPLOYEE_2, [], 500);
    const prevBurnRate = await payroll.calculatePayrollBurnrate();

    await payroll.removeEmployee(EMPLOYEE_1_ID);
    const newBurnRate = await payroll.calculatePayrollBurnrate();
    assert.isBelow(newBurnRate.toNumber(), prevBurnRate.toNumber());
  });

  it("should calculate runway based on all employees", async () => {
    const SALARY = 70000;
    const employees = [EMPLOYEE_1, EMPLOYEE_2, EMPLOYEE_3];
    employees.forEach(async (employee) => {
      await payroll.addEmployee(employee, [], SALARY);
    });
    const USD_FUNDS_ADDED = SALARY * employees.length / 2; // ~6 months
    const ETH_FUNDS_ADDED = USD_FUNDS_ADDED * BASE_ETH_USD_EXCHANGE_RATE; // ~6 months
    await payroll.addFunds({ value: ETH_FUNDS_ADDED });

    const runway = await payroll.calculatePayrollRunway();
    // Due to internal EVM truncation, let's allow some wiggle room in the figure
    assert.equal(Math.floor(USD_FUNDS_ADDED / (SALARY * employees.length / 365)), runway.toNumber());
  });

  it("should update runway after transferring funds", async () => {
    const SALARY = 70000;
    const FUNDS_ADDED = SALARY * BASE_ETH_USD_EXCHANGE_RATE / 4; // ~3 months
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await payroll.addFunds({ value: FUNDS_ADDED });
    const prevRunway = await payroll.calculatePayrollRunway();

    await payroll.addFunds({ value: FUNDS_ADDED / 2 });
    const newRunway = await payroll.calculatePayrollRunway();
    assert.isAbove(newRunway.toNumber(), prevRunway.toNumber());
  });

  it("should update runway after adding employee", async () => {
    const SALARY = 70000;
    const FUNDS_ADDED = SALARY * BASE_ETH_USD_EXCHANGE_RATE / 2; // ~6 months
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await payroll.addFunds({ value: FUNDS_ADDED });
    const prevRunway = await payroll.calculatePayrollRunway();

    await payroll.addEmployee(EMPLOYEE_2, [], SALARY);
    const newRunway = await payroll.calculatePayrollRunway();
    assert.isBelow(newRunway.toNumber(), prevRunway.toNumber());
  });

  it("should update runway after changing employee salary", async () => {
    const SALARY = 70000;
    const FUNDS_ADDED = SALARY * BASE_ETH_USD_EXCHANGE_RATE / 2; // ~6 months
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await payroll.addFunds({ value: FUNDS_ADDED });
    const prevRunway = await payroll.calculatePayrollRunway();

    await payroll.setEmployeeSalary(EMPLOYEE_1_ID, SALARY * 2);
    const newRunway = await payroll.calculatePayrollRunway();
    assert.isBelow(newRunway.toNumber(), prevRunway.toNumber());
  });

  it("should update runway after removing employee", async () => {
    const SALARY = 70000;
    const FUNDS_ADDED = SALARY * BASE_ETH_USD_EXCHANGE_RATE / 2; // ~6 months
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await payroll.addEmployee(EMPLOYEE_2, [], SALARY);
    await payroll.addFunds({ value: FUNDS_ADDED });
    const prevRunway = await payroll.calculatePayrollRunway();

    await payroll.removeEmployee(EMPLOYEE_1_ID);
    const newRunway = await payroll.calculatePayrollRunway();
    assert.isAbove(newRunway.toNumber(), prevRunway.toNumber());
  });

  /*
  it("should allow an employee to allocate salary", async () => {
    const USD_ALLOCATION = 10;
    const ETH_ALLOCATION = 65;
    const ANT_ALLOCATION = 25;
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);

    await payroll.determineAllocation(
      [usd.address, eth.address, ant.address],
      [USD_ALLOCATION, ETH_ALLOCATION, ANT_ALLOCATION],
      { from: EMPLOYEE_1 }
    );
    const [usdAddress, usdDistribution] = await payroll.getEmployeeTokenDistribution(EMPLOYEE_1_ID, 0);
    const [ethAddress, ethDistribution] = await payroll.getEmployeeTokenDistribution(EMPLOYEE_1_ID, 1);
    const [antAddress, antDistribution] = await payroll.getEmployeeTokenDistribution(EMPLOYEE_1_ID, 2);
    assert.equal(usdAddress, usd.address);
    assert.equal(usdDistribution, USD_ALLOCATION);
    assert.equal(ethAddress, eth.address);
    assert.equal(ethDistribution, ETH_ALLOCATION);
    assert.equal(antAddress, ant.address);
    assert.equal(antDistribution, ANT_ALLOCATION);
  });
  */

  /*
  it("should allow an employee to allocate salary to only USD by default", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);

    await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });
    const [address, distribution] = await payroll.getEmployeeTokenDistribution(EMPLOYEE_1_ID, 0);
    assert.equal(address, usd.address);
    assert.equal(distribution, 100);
  });
  */

  it("should not allow an employee to allocate salary if too soon", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);
    await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });

    try {
      await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });
      assert.fail("should have thrown on allocating too soon");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow an employee to allocate less than 100%", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);

    try {
      await payroll.determineAllocation([eth.address, btc.address], [10, 10], { from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow an employee to allocate non-allowed tokens", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);

    try {
      await payroll.determineAllocation([btc.address], [100], { from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow an employee to allocate non-watched tokens", async () => {
    const bcc = await MockToken.new();
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);

    try {
      await payroll.determineAllocation([bcc.address], [100], { from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow an employee to mismatch token and distribution lengths", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], 150000);

    try {
      await payroll.determineAllocation([], [100], { from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.determineAllocation([usd.address], [], { from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }
  });

  /*
  it("should allow an employee to payout their salary based on custom allocation", async () => {
    // Remember our Payout contract isn't equipped to transer ETH because it assumes
    // transferring ETH to someone else uses the ERC20 interface
    const USD_ALLOCATION = 50;
    const BTC_ALLOCATION = 25;
    const ANT_ALLOCATION = 25;
    const SALARY = 150000;
    const MONTHLY_SALARY = SALARY / 365 * 28;
    // Allow some wiggle room for internal EVM truncation
    const MONTHLY_USD_SALARY = Math.floor(MONTHLY_SALARY * USD_ALLOCATION / 100);
    const MONTHLY_BTC_SALARY = Math.floor(BASE_BTC_USD_EXCHANGE_RATE * MONTHLY_SALARY * BTC_ALLOCATION / 100);
    const MONTHLY_ANT_SALARY = Math.floor(BASE_ANT_USD_EXCHANGE_RATE * MONTHLY_SALARY * ANT_ALLOCATION / 100);

    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], SALARY);
    await payroll.setEmployeePayDate(EMPLOYEE_1_ID, 0); // Allow employee to be paid
    const prevEmployeeUsdHoldings = (await usd.balanceOf(EMPLOYEE_1)).toNumber();
    const prevEmployeeBtcHoldings = (await btc.balanceOf(EMPLOYEE_1)).toNumber();
    const prevEmployeeAntHoldings = (await ant.balanceOf(EMPLOYEE_1)).toNumber();
    await payroll.determineAllocation(
      [usd.address, btc.address, ant.address],
      [USD_ALLOCATION, BTC_ALLOCATION, ANT_ALLOCATION],
      { from: EMPLOYEE_1 }
    );

    // Add ~6 months of funds
    await usd.transfer(payroll.address, MONTHLY_USD_SALARY * 6);
    await btc.transfer(payroll.address, MONTHLY_BTC_SALARY * 6);
    await ant.transfer(payroll.address, MONTHLY_ANT_SALARY * 6);

    await payroll.payday({ from: EMPLOYEE_1 });
    const newEmployeeUsdHoldings = (await usd.balanceOf(EMPLOYEE_1)).toNumber();
    const newEmployeeBtcHoldings = (await btc.balanceOf(EMPLOYEE_1)).toNumber();
    const newEmployeeAntHoldings = (await ant.balanceOf(EMPLOYEE_1)).toNumber();
    assert.equal(prevEmployeeUsdHoldings + MONTHLY_USD_SALARY, newEmployeeUsdHoldings);
    assert.equal(prevEmployeeBtcHoldings + MONTHLY_BTC_SALARY, newEmployeeBtcHoldings);
    assert.equal(prevEmployeeAntHoldings + MONTHLY_ANT_SALARY, newEmployeeAntHoldings);
  });
  */

  /*
  it("should allow an employee to default their salary payout as 100% USD", async () => {
    const SALARY = 150000;
    const MONTHLY_SALARY = Math.floor(SALARY / 365 * 28); // Allow some EVM truncation wiggle room
    await payroll.addEmployee(EMPLOYEE_1, [btc.address, ant.address], SALARY);
    await payroll.setEmployeePayDate(EMPLOYEE_1_ID, 0); // Allow employee to be paid
    const prevEmployeeUsdHoldings = (await usd.balanceOf(EMPLOYEE_1)).toNumber();

    // Add ~6 months of funds
    await usd.transfer(payroll.address, SALARY / 2);

    await payroll.payday({ from: EMPLOYEE_1 });
    const newEmployeeUsdHoldings = (await usd.balanceOf(EMPLOYEE_1)).toNumber();
    assert.equal(prevEmployeeUsdHoldings + MONTHLY_SALARY, newEmployeeUsdHoldings);
  });

  it("should not allow an employee to payout salary if too soon", async () => {
    const SALARY = 150000;
    await payroll.addEmployee(EMPLOYEE_1, [], SALARY);
    await usd.transfer(payroll.address, SALARY / 2);

    try {
      await payroll.payday({ from: EMPLOYEE_1 });
    } catch (error) {
      assertJump(error);
    }
  });
  */

  /*
  it("should set a new oracle", async () => {
    const newOracle = await MockOracle.new();
    assert.notEqual(newOracle.address, oracle.address);

    await payroll.setExchangeOracle(newOracle.address);
    const newPayrollOracle = await payroll.getExchangeOracle();

    assert.equal(newPayrollOracle, newOracle.address);
  });
  */

  /*
  it("should set a new runway limit", async () => {
    const newRunwayLimit = 700;
    const oldRunwayLimit = await payroll.getRunwayLimit();
    assert.notEqual(newRunwayLimit, oldRunwayLimit);

    await payroll.setRunwayLimit(newRunwayLimit);
    const curRunwayLimit = await payroll.getRunwayLimit();

    assert.equal(newRunwayLimit, curRunwayLimit);
  });
  */

  it("should allow the owner to retrieve all funds when paused", async () => {
    const FUNDS_ADDED = 5000;
    // Adjust ETH transfer to be in higher unit, so spending gas in calls don't cause issues
    await payroll.addFunds({ value: FUNDS_ADDED * 1000000000000000 });
    await usd.transfer(payroll.address, FUNDS_ADDED);
    await payroll.pause();
    assert.notEqual(web3.eth.getBalance(payroll.address).toNumber(), 0);
    assert.notEqual((await usd.balanceOf(payroll.address)).toNumber(), 0);

    const prevOwnerEthHolding = web3.eth.getBalance(OWNER).toNumber();
    const prevOwnerUsdHolding = (await usd.balanceOf(OWNER)).toNumber();

    await payroll.scapeHatch();

    const newOwnerEthHolding = web3.eth.getBalance(OWNER).toNumber();
    const newOwnerUsdHolding = (await usd.balanceOf(OWNER)).toNumber();
    assert.isAbove(newOwnerEthHolding, prevOwnerEthHolding);
    assert.isAbove(newOwnerUsdHolding, prevOwnerUsdHolding);

    assert.equal(web3.eth.getBalance(payroll.address).toNumber(), 0);
    assert.equal((await usd.balanceOf(payroll.address)).toNumber(), 0);
    assert.equal((await btc.balanceOf(payroll.address)).toNumber(), 0);
    assert.equal((await ant.balanceOf(payroll.address)).toNumber(), 0);
  });

  /* INTERFACE SANITY CHECKS */
  it("should not allow a non-owner to call onlyOwner functions", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    await payroll.addFunds({ value: 100000 });

    try {
      await payroll.addEmployee(EMPLOYEE_2, [], 150000, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on adding employee as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, usd.address, true, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on setting allowed token as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setEmployeeSalary(EMPLOYEE_1_ID, 2000000, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on setting salary as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.removeEmployee(EMPLOYEE_1_ID, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on removing employee as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setExchangeOracle(oracle.address, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on setting oracle as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setRunwayLimit(2000, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on setting runway limit as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.calculatePayrollBurnrate({ from: EMPLOYEE_1 });
      assert.fail("should have thrown on calculating burn rate as non-owner");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.calculatePayrollRunway({ from: EMPLOYEE_1 });
      assert.fail("should have thrown on calculating runway as non-owner");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow a non-active employee to call onlyActiveEmployee functions", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    await payroll.removeEmployee(EMPLOYEE_1_ID);

    try {
      await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });
      assert.fail("should have thrown on determining allocation as non-active employee");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.payday({ from: EMPLOYEE_1 });
      assert.fail("should have thrown on payday as non-active employee");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow onlyOnActiveEmployee functions to be used for non-active employees", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    await payroll.removeEmployee(EMPLOYEE_1_ID);

    try {
      await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, btc.address, false);
      assert.fail("should have thrown on setting allowed token on non-active employee");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setEmployeeSalary(EMPLOYEE_1_ID, 200000);
      assert.fail("should have thrown on setting salary on non-active employee");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.removeEmployee(EMPLOYEE_1_ID);
      assert.fail("should have thrown on removing non-active employee");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow a non-oracle to call onlyOracle functions", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);

    try {
      await payroll.setExchangeRate(btc.address, 50000, { from: EMPLOYEE_1 });
      assert.fail("should have thrown on setting exchange rate as non-oracle");
    } catch (error) {
      assertJump(error);
    }
  });

  it("should not allow whenNotPaused functions to be used when paused", async () => {
    await payroll.addEmployee(EMPLOYEE_1, [], 150000);
    await payroll.addFunds({ value: 100000 });
    await payroll.pause();

    try {
      await payroll.addEmployee(EMPLOYEE_2, [], 150000);
      assert.fail("should have thrown on adding employee when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setEmployeeAllowedToken(EMPLOYEE_1_ID, usd.address, true);
      assert.fail("should have thrown on setting allowed token when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setEmployeeSalary(EMPLOYEE_1_ID, 2000000);
      assert.fail("should have thrown on setting salary when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.removeEmployee(EMPLOYEE_1_ID);
      assert.fail("should have thrown on removing employee when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setExchangeOracle(oracle.address);
      assert.fail("should have thrown on setting oracle when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.setRunwayLimit(2000);
      assert.fail("should have thrown on setting runway limit when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.addFunds({ value: 50 });
      assert.fail("should have thrown on adding ETH funds when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await btc.transfer(payroll.address, 50); // Calls addTokenFunds
      assert.fail("should have thrown on adding token funds when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.determineAllocation([], [], { from: EMPLOYEE_1 });
      assert.fail("should have thrown on determining allocation when paused");
    } catch (error) {
      assertJump(error);
    }

    try {
      await payroll.payday({ from: EMPLOYEE_1 });
      assert.fail("should have thrown on payday when paused");
    } catch (error) {
      assertJump(error);
    }
  });
});
