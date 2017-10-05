ETH Payroll
===========

### :bangbang::rotating_light: Not for production!

Sample payroll contract for Ethereum.

You should be able to run the tests after installing (`npm install`) and then running `npm
run test`.

:rotating_light: note that some of the functionality and tests have been deactivated due to hitting
the deployment gas limit in truffle's default test sandbox. See the [contract](./contracts/Payroll.sol)
and [test](./test/Payroll.js) for more details.

### Notes

- The [contract](./contracts/Payroll.sol) has been liberally commented to flesh out the details
- The `payday()` function assumes that ETH has been implemented as a ERC20 contract, but the rest of
  the contract assumes usage of the native functions (i.e. `this.balance`, `address.transfer`)
- The usage of the exchange rate oracle also assumes that it knows of an address for an ETH ERC20
  contract
- Getting time right is difficult, so this contracts opts to think in fixed-time weeks (28 days)
  rather than in months (resulting in ~13 months/year); using a weekly salary would make the math
  easier and more accurate
- I assume all employees will be rushing to siphon their monthly salaries; there is no built-in
  mechanism for accumulating monthly salaries if they don't take money out before their pay date
  refreshes
- I assume that the owner of the contract can easily liquidate or exchange any tokens to any
  other tokens, so that the runway can be calculated as a total of all held funds rather than
  the minimum time to deplete an individual token holding
- I assume this contract won't have to be watching too many tokens, otherwise it's going to get
  expen$ive...
