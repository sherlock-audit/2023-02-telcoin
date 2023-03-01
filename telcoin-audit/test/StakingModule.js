const { expect, assert } = require("chai")
const { ethers, upgrades } = require("hardhat")
const { mine, getLatestBlockNumber } = require("./util/helpers")
const helpers = require("@nomicfoundation/hardhat-network-helpers")

const emptyBytes = []

describe("StakingModule", () => {
  let deployer
  let slasher
  let pluginEditor
  let bob
  let charlie
  let slashCollector
  let recoveryRoleHolder
  let migrator

  let telContract
  let stakingContract

  let DEFAULT_ADMIN
  let SLASHER_ROLE
  let PLUGIN_EDITOR_ROLE
  let RECOVERY_ROLE
  let MIGRATOR_ROLE

  const telTotalSupply = ethers.BigNumber.from(1e18 + "")

  async function deployNMockPlugins(n) {
    const ans = []
    const PluginFactory = await ethers.getContractFactory(
      "TestPlugin",
      deployer
    )
    for (let i = 0; i < n; i++) {
      const c = await PluginFactory.deploy()
      ans.push(c)
      await c.deployed()
    }
    return ans
  }

  beforeEach("setup", async () => {
    ;[
      deployer,
      slasher,
      pluginEditor,
      bob,
      charlie,
      slashCollector,
      recoveryRoleHolder,
      migrator
    ] = await ethers.getSigners()

    const TELFactory = await ethers.getContractFactory("TestTelcoin", deployer)
    const StakingModuleFactory = await ethers.getContractFactory(
      "StakingModule",
      deployer
    )

    telContract = await TELFactory.deploy(deployer.address)
    await telContract.deployed()

    stakingContract = await upgrades.deployProxy(StakingModuleFactory, [
      telContract.address,
      3600,
      10
    ])
    await stakingContract.deployed()

    expect(await telContract.balanceOf(deployer.address)).to.equal("100000000000000000000000000000")
    expect(await stakingContract.tel()).to.equal(telContract.address)

    DEFAULT_ADMIN = await stakingContract.DEFAULT_ADMIN_ROLE()
    SLASHER_ROLE = await stakingContract.SLASHER_ROLE()
    PLUGIN_EDITOR_ROLE = await stakingContract.PLUGIN_EDITOR_ROLE()
    RECOVERY_ROLE = await stakingContract.RECOVERY_ROLE()
    MIGRATOR_ROLE = await stakingContract.MIGRATOR_ROLE()
  })

  describe("roles", () => {
    describe("DEFAULT_ADMIN", () => {
      it("should be only deployer address", async () => {
        expect(
          await stakingContract.getRoleMemberCount(DEFAULT_ADMIN)
        ).to.equal(1)
        expect(await stakingContract.getRoleMember(DEFAULT_ADMIN, 0)).to.equal(
          deployer.address
        )
      })

      it("should not be changeable by non admin", async () => {
        await expect(
          stakingContract.connect(bob).grantRole(DEFAULT_ADMIN, bob.address)
        ).to.be.revertedWith("AccessControl: account " + (bob.address).toLowerCase() + " is missing role " + DEFAULT_ADMIN)
      })

      it("should be transferrable", async () => {
        await stakingContract
          .connect(deployer)
          .grantRole(DEFAULT_ADMIN, bob.address)
        expect(
          await stakingContract.getRoleMemberCount(DEFAULT_ADMIN)
        ).to.equal(2)

        await stakingContract
          .connect(deployer)
          .revokeRole(DEFAULT_ADMIN, deployer.address)

        expect(await stakingContract.hasRole(DEFAULT_ADMIN, bob.address)).to.be
          .true
        expect(await stakingContract.hasRole(DEFAULT_ADMIN, deployer.address))
          .to.be.false
      })
    })

    describe("SLASHER_ROLE/PLUGIN_EDITOR_ROLE", () => {
      it("should have no members", async () => {
        expect(await stakingContract.getRoleMemberCount(SLASHER_ROLE)).to.equal(
          0
        )
        expect(
          await stakingContract.getRoleMemberCount(PLUGIN_EDITOR_ROLE)
        ).to.equal(0)
      })

      describe("when granted by non admin", () => {
        it("should fail", async () => {
          await expect(
            stakingContract.connect(bob).grantRole(SLASHER_ROLE, bob.address)
          ).to.be.revertedWith("AccessControl: account " + (bob.address).toLowerCase() + " is missing role " + DEFAULT_ADMIN)
          await expect(
            stakingContract
              .connect(bob)
              .grantRole(PLUGIN_EDITOR_ROLE, bob.address)
          ).to.be.revertedWith("AccessControl: account " + (bob.address).toLowerCase() + " is missing role " + DEFAULT_ADMIN)
        })
      })

      describe("when granted by admin", () => {
        beforeEach(async () => {
          await stakingContract
            .connect(deployer)
            .grantRole(SLASHER_ROLE, slasher.address)
          await stakingContract
            .connect(deployer)
            .grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)
        })

        it("should set role", async () => {
          expect(
            await stakingContract.getRoleMemberCount(SLASHER_ROLE)
          ).to.equal(1)
          expect(
            await stakingContract.getRoleMemberCount(PLUGIN_EDITOR_ROLE)
          ).to.equal(1)

          expect(await stakingContract.hasRole(SLASHER_ROLE, slasher.address))
            .to.be.true
          expect(
            await stakingContract.hasRole(
              PLUGIN_EDITOR_ROLE,
              pluginEditor.address
            )
          ).to.be.true
        })

        describe("when a member tries to edit their own role", () => {
          it("should fail", async () => {
            await expect(
              stakingContract
                .connect(slasher)
                .grantRole(SLASHER_ROLE, bob.address)
            ).to.be.revertedWith("AccessControl: account " + (slasher.address).toLowerCase() + " is missing role " + DEFAULT_ADMIN)
            await expect(
              stakingContract
                .connect(pluginEditor)
                .grantRole(PLUGIN_EDITOR_ROLE, bob.address)
            ).to.be.revertedWith("AccessControl: account " + (pluginEditor.address).toLowerCase() + " is missing role " + DEFAULT_ADMIN)
          })
        })
      })
    })
  })

  describe("delayedWithdrawal", () => {
    describe("when withdrawalDelay is 0", () => {
      it("claim, exit, fullClaimAndExit, partialClaimAndExit should not revert", async () => {
        await expect(stakingContract.connect(bob).exit()).to.not.be.reverted
        await expect(stakingContract.connect(bob).claim(emptyBytes)).to.not.be
          .reverted
        await expect(stakingContract.connect(bob).fullClaimAndExit(emptyBytes))
          .to.not.be.reverted
        await expect(
          stakingContract.connect(bob).partialClaimAndExit(0, emptyBytes)
        ).to.not.be.reverted
      })
    })

    describe("when withdrawalDelay is nonzero", () => {
      const delay = 60
      const window = 30
      beforeEach(async () => {
        await stakingContract
          .connect(deployer)
          .grantRole(SLASHER_ROLE, slasher.address)
        await stakingContract
          .connect(slasher)
          .setWithdrawDelayAndWindow(delay, window)
      })

      describe("when user does not request withdrawal first", () => {
        it("claim, exit, fullClaimAndExit, partialClaimAndExit should fail", async () => {
          await expect(stakingContract.connect(bob).exit()).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).claim(emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).fullClaimAndExit(emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).partialClaimAndExit(0, emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
        })
      })

      describe("when user requests withdrawal", () => {
        beforeEach(async () => {
          await stakingContract.connect(bob).requestWithdrawal()
        })

        it("claim, exit, fullClaimAndExit, partialClaimAndExit should fail if user does not wait enough time", async () => {
          await expect(stakingContract.connect(bob).exit()).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).claim(emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).fullClaimAndExit(emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
          await expect(
            stakingContract.connect(bob).partialClaimAndExit(0, emptyBytes)
          ).to.be.revertedWith(
            "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
          )
        })

        describe("when user waits enough time", () => {
          beforeEach(async () => {
            await helpers.time.increase(delay)
          })

          it("claim should not fail", async () => {
            await expect(stakingContract.connect(bob).claim(emptyBytes)).to.not
              .be.reverted
          })

          it("exit should not fail", async () => {
            await expect(stakingContract.connect(bob).exit()).to.not.be.reverted
          })

          it("fullClaimAndExit should not fail", async () => {
            await expect(
              stakingContract.connect(bob).fullClaimAndExit(emptyBytes)
            ).to.not.be.reverted
          })

          it("partialClaimAndExit should not fail", async () => {
            await expect(
              stakingContract.connect(bob).partialClaimAndExit(0, emptyBytes)
            ).to.not.be.reverted
          })

          it("should not be able to claim twice without re-requestingWithdraw", async () => {
            await expect(stakingContract.connect(bob).claim(emptyBytes)).to.not
              .be.reverted
            await expect(
              stakingContract.connect(bob).claim(emptyBytes)
            ).to.be.revertedWith(
              "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
            )
          })
        })

        describe("when user waits too much time", () => {
          beforeEach(async () => {
            await helpers.time.increase(delay + window + 1)
          })

          it("claim, exit, fullClaimAndExit, partialClaimAndExit should fail", async () => {
            await expect(
              stakingContract.connect(bob).exit()
            ).to.be.revertedWith(
              "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
            )
            await expect(
              stakingContract.connect(bob).claim(emptyBytes)
            ).to.be.revertedWith(
              "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
            )
            await expect(
              stakingContract.connect(bob).fullClaimAndExit(emptyBytes)
            ).to.be.revertedWith(
              "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
            )
            await expect(
              stakingContract.connect(bob).partialClaimAndExit(0, emptyBytes)
            ).to.be.revertedWith(
              "StakingModule: Withdrawal not requested yet or it is too early/late to withdraw"
            )
          })
        })
      })
    })
  })

  describe("staking", () => {
    const bobInitialBalance = 100
    const bobAmtStake = 10
    const charlieInitialBalance = 200
    const charlieAmtStake = 23

    beforeEach(async () => {
      await telContract
        .connect(deployer)
        .transfer(bob.address, bobInitialBalance)
      expect(await telContract.balanceOf(bob.address)).to.equal(
        bobInitialBalance
      )

      await telContract
        .connect(deployer)
        .transfer(charlie.address, charlieInitialBalance)
      expect(await telContract.balanceOf(charlie.address)).to.equal(
        charlieInitialBalance
      )
    })

    describe("when not approved", () => {
      it("should fail", async () => {
        await expect(stakingContract.connect(bob).stake(bobAmtStake)).to.be
          .reverted
      })
    })

    describe("when staking amount is more than balance", () => {
      it("should fail", async () => {
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)
        await expect(stakingContract.connect(bob).stake(bobInitialBalance + 1))
          .to.be.reverted
      })
    })

    describe("when staking amount is 0", () => {
      it("should fail", async () => {
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)
        await expect(stakingContract.connect(bob).stake(0)).to.be.reverted
      })
    })

    describe("when bob, charlie, bob successfully stake", () => {
      let bobStakeBlock1
      let bobStakeTx1
      let charlieStakeBlock2
      let charlieStakeTx2
      let bobStakeBlock3
      let bobStakeTx3
      const blocksToMine = 10

      beforeEach(async () => {
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)
        await telContract
          .connect(charlie)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        bobStakeTx1 = await stakingContract.connect(bob).stake(bobAmtStake)
        bobStakeBlock1 = bobStakeTx1.blockNumber || -1
        assert(bobStakeBlock1 != -1)

        await mine(blocksToMine)

        charlieStakeTx2 = await stakingContract
          .connect(charlie)
          .stake(charlieAmtStake)
        charlieStakeBlock2 = charlieStakeTx2.blockNumber || -1
        assert(bobStakeBlock1 != -1)

        await mine(blocksToMine)

        bobStakeTx3 = await stakingContract.connect(bob).stake(bobAmtStake)
        bobStakeBlock3 = bobStakeTx3.blockNumber || -1
        assert(bobStakeBlock3 != -1)

        await mine(blocksToMine)
      })

      it("should emit StakeChanged", async () => {
        expect(bobStakeTx1).to.emit(stakingContract, "StakeChanged")
        expect(charlieStakeTx2).to.emit(stakingContract, "StakeChanged")
        expect(bobStakeTx3).to.emit(stakingContract, "StakeChanged")

        expect(bobStakeTx1).to.emit(telContract, "Transfer")
        expect(charlieStakeTx2).to.emit(telContract, "Transfer")
        expect(bobStakeTx3).to.emit(telContract, "Transfer")
      })

      it("should increase TEL balance of StakingModule", async () => {
        expect(await telContract.balanceOf(stakingContract.address)).to.equal(
          2 * bobAmtStake + charlieAmtStake
        )
      })

      it("should increase balanceOf(bob)", async () => {
        expect(
          await stakingContract.balanceOf(bob.address, emptyBytes)
        ).to.equal(2 * bobAmtStake)
      })

      it("should increase stakedBy(bob)", async () => {
        expect(await stakingContract.stakedBy(bob.address)).to.equal(
          2 * bobAmtStake
        )
      })

      it("should increase totalStaked()", async () => {
        expect(await stakingContract.totalStaked()).to.equal(
          2 * bobAmtStake + charlieAmtStake
        )
      })

      it("should increase totalSupply()", async () => {
        expect(await stakingContract.totalSupply()).to.equal(
          2 * bobAmtStake + charlieAmtStake
        )
      })

      it("should create checkpoints before, at, and after both stake", async () => {
        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock1 - 1)
        ).to.equal(0)
        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock1)
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock1 + 1)
        ).to.equal(bobAmtStake)

        expect(
          await stakingContract.balanceOfAt(
            bob.address,
            bobStakeBlock1 - 1,
            "0x"
          )
        ).to.equal(0)
        expect(
          await stakingContract.balanceOfAt(bob.address, bobStakeBlock1, "0x")
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.balanceOfAt(
            bob.address,
            bobStakeBlock1 + 1,
            "0x"
          )
        ).to.equal(bobAmtStake)

        expect(
          await stakingContract.stakedByAt(
            charlie.address,
            charlieStakeBlock2 - 1
          )
        ).to.equal(0)
        expect(
          await stakingContract.stakedByAt(charlie.address, charlieStakeBlock2)
        ).to.equal(charlieAmtStake)
        expect(
          await stakingContract.stakedByAt(
            charlie.address,
            charlieStakeBlock2 + 1
          )
        ).to.equal(charlieAmtStake)

        expect(
          await stakingContract.balanceOfAt(
            charlie.address,
            charlieStakeBlock2 - 1,
            "0x"
          )
        ).to.equal(0)
        expect(
          await stakingContract.balanceOfAt(
            charlie.address,
            charlieStakeBlock2,
            "0x"
          )
        ).to.equal(charlieAmtStake)
        expect(
          await stakingContract.balanceOfAt(
            charlie.address,
            charlieStakeBlock2 + 1,
            "0x"
          )
        ).to.equal(charlieAmtStake)

        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock3 - 1)
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock3)
        ).to.equal(2 * bobAmtStake)
        expect(
          await stakingContract.stakedByAt(bob.address, bobStakeBlock3 + 1)
        ).to.equal(2 * bobAmtStake)

        expect(
          await stakingContract.balanceOfAt(
            bob.address,
            bobStakeBlock3 - 1,
            "0x"
          )
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.balanceOfAt(bob.address, bobStakeBlock3, "0x")
        ).to.equal(2 * bobAmtStake)
        expect(
          await stakingContract.balanceOfAt(
            bob.address,
            bobStakeBlock3 + 1,
            "0x"
          )
        ).to.equal(2 * bobAmtStake)
      })

      it("should fail to get checkpoint in the future", async () => {
        await expect(
          stakingContract.stakedByAt(bob.address, await getLatestBlockNumber())
        ).to.be.reverted
        await expect(
          stakingContract.balanceOfAt(
            bob.address,
            await getLatestBlockNumber(),
            "0x"
          )
        ).to.be.reverted
      })
    })
  })

  describe("claim", () => {
    describe("when no yield", () => {
      let claimTx

      beforeEach(async () => {
        claimTx = await stakingContract.connect(bob).claim(emptyBytes)
      })

      it("should do nothing", async () => {
        expect(claimTx).to.not.emit(stakingContract, "Claimed")
        expect(claimTx).to.not.emit(telContract, "Transfer")
      })
    })
  })

  describe("claimFromIndividualPlugin", () => {
    it("should fail when invalid plugin address is provided", async () => {
      await expect(
        stakingContract
          .connect(bob)
          .claimFromIndividualPlugin(
            ethers.Wallet.createRandom().address,
            emptyBytes
          )
      ).to.be.revertedWith(
        "StakingModule::_claimFromIndividualPlugin: Provided pluginAddress is invalid"
      )
    })
  })

  describe("exit", () => {
    describe("when nothing is staked", () => {
      let exitTx

      beforeEach(async () => {
        exitTx = await stakingContract.connect(bob).exit()
      })

      it("should do nothing", async () => {
        expect(exitTx).to.not.emit(stakingContract, "StakeChanged")
        expect(exitTx).to.not.emit(telContract, "Transfer")
      })
    })

    describe("when something is staked", () => {
      let stakeBlock
      let stakeTx
      let exitBlock
      let exitTx

      const blocksToMine = 10

      const bobInitialBalance = 100
      const bobAmtStake = 10

      const charlieInitialBalance = 200
      const charlieAmtStake = 23

      beforeEach(async () => {
        await telContract
          .connect(deployer)
          .transfer(bob.address, bobInitialBalance)
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        await telContract
          .connect(deployer)
          .transfer(charlie.address, charlieInitialBalance)
        await telContract
          .connect(charlie)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        await stakingContract.connect(charlie).stake(charlieAmtStake)

        stakeTx = await stakingContract.connect(bob).stake(bobAmtStake)
        stakeBlock = stakeTx.blockNumber || -1
        assert(stakeBlock != -1)

        await mine(blocksToMine)

        exitTx = await stakingContract.connect(bob).exit()
        exitBlock = exitTx.blockNumber || -1
        assert(exitBlock != -1)

        await mine(blocksToMine)
      })

      it("should emit StakeChanged", async () => {
        expect(exitTx).to.emit(stakingContract, "StakeChanged")
      })

      it("should decrease TEL balance of StakingModule", async () => {
        expect(await telContract.balanceOf(stakingContract.address)).to.equal(
          charlieAmtStake
        )
      })

      it("should decrease balanceOf(bob)", async () => {
        expect(
          await stakingContract.balanceOf(bob.address, emptyBytes)
        ).to.equal(0)
      })

      it("should decrease stakedBy(bob)", async () => {
        expect(await stakingContract.stakedBy(bob.address)).to.equal(0)
      })

      it("should decrease totalStaked()", async () => {
        expect(await stakingContract.totalStaked()).to.equal(charlieAmtStake)
      })

      it("should decrease totalSupply()", async () => {
        expect(await stakingContract.totalSupply()).to.equal(charlieAmtStake)
      })

      it("should create checkpoints before, at, and after both stake", async () => {
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock - 1)
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock)
        ).to.equal(0)
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock + 1)
        ).to.equal(0)

        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock - 1, "0x")
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock, "0x")
        ).to.equal(0)
        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock + 1, "0x")
        ).to.equal(0)
      })
    })
  })

  describe("partialExit", () => {
    describe("when nothing is staked", () => {
      let exitTx

      beforeEach(async () => {
        exitTx = await stakingContract.connect(bob).exit()
      })

      it("should do nothing", async () => {
        expect(exitTx).to.not.emit(stakingContract, "StakeChanged")
        expect(exitTx).to.not.emit(telContract, "Transfer")
      })
    })

    describe("when something is staked", () => {
      let stakeBlock
      let stakeTxPromise
      let exitBlock
      let exitTxPromise

      const blocksToMine = 10

      const bobInitialBalance = 100
      const bobAmtStake = 10
      const bobAmtUnstake = 5

      const charlieInitialBalance = 200
      const charlieAmtStake = 23

      beforeEach(async () => {
        await telContract
          .connect(deployer)
          .transfer(bob.address, bobInitialBalance)
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        await telContract
          .connect(deployer)
          .transfer(charlie.address, charlieInitialBalance)
        await telContract
          .connect(charlie)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        await stakingContract.connect(charlie).stake(charlieAmtStake)

        stakeTxPromise = stakingContract.connect(bob).stake(bobAmtStake)
        await stakeTxPromise
        stakeBlock = (await stakeTxPromise).blockNumber || -1
        assert(stakeBlock != -1)

        await mine(blocksToMine)

        exitTxPromise = stakingContract.connect(bob).partialExit(bobAmtUnstake)
        await exitTxPromise
        exitBlock = (await exitTxPromise).blockNumber || -1
        assert(exitBlock != -1)

        await mine(blocksToMine)
      })

      it("should emit StakeChanged", async () => {
        await expect(exitTxPromise).to.emit(stakingContract, "StakeChanged")
      })

      it("should decrease TEL balance of StakingModule", async () => {
        expect(await telContract.balanceOf(stakingContract.address)).to.equal(
          charlieAmtStake + bobAmtStake - bobAmtUnstake
        )
      })

      it("should decrease balanceOf(bob)", async () => {
        expect(
          await stakingContract.balanceOf(bob.address, emptyBytes)
        ).to.equal(bobAmtStake - bobAmtUnstake)
      })

      it("should decrease stakedBy(bob)", async () => {
        expect(await stakingContract.stakedBy(bob.address)).to.equal(
          bobAmtStake - bobAmtUnstake
        )
      })

      it("should decrease totalStaked()", async () => {
        expect(await stakingContract.totalStaked()).to.equal(
          charlieAmtStake + bobAmtStake - bobAmtUnstake
        )
      })

      it("should decrease totalSupply()", async () => {
        expect(await stakingContract.totalSupply()).to.equal(
          charlieAmtStake + bobAmtStake - bobAmtUnstake
        )
      })

      it("should create checkpoints before, at, and after both stake", async () => {
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock - 1)
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock)
        ).to.equal(bobAmtStake - bobAmtUnstake)
        expect(
          await stakingContract.stakedByAt(bob.address, exitBlock + 1)
        ).to.equal(bobAmtStake - bobAmtUnstake)

        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock - 1, "0x")
        ).to.equal(bobAmtStake)
        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock, "0x")
        ).to.equal(bobAmtStake - bobAmtUnstake)
        expect(
          await stakingContract.balanceOfAt(bob.address, exitBlock + 1, "0x")
        ).to.equal(bobAmtStake - bobAmtUnstake)
      })
    })
  })

  describe("checkpointProtection", () => {
    describe("when checkpoints are attacked via flashloan type thing", () => {
      let exploitContract
      const flashloanAmount = 10

      beforeEach(async () => {
        const FlashloanExploitFactory = await ethers.getContractFactory(
          "TestFlashloanExploit",
          deployer
        )

        exploitContract = await FlashloanExploitFactory.deploy(
          stakingContract.address,
          telContract.address
        )
        await exploitContract.deployed()

        await telContract
          .connect(deployer)
          .transfer(exploitContract.address, flashloanAmount)
      })

      it("should fail", async () => {
        await expect(exploitContract.pwn()).to.be.revertedWith(
          "StakingModule: Cannot exit in the same block as another stake or exit"
        )
        await expect(exploitContract.pwn2()).to.be.revertedWith(
          "StakingModule: Cannot exit in the same block as another stake or exit"
        )
        await expect(exploitContract.pwn3()).to.be.revertedWith(
          "StakingModule: Cannot exit in the same block as another stake or exit"
        )
        await expect(exploitContract.pwn4()).to.be.revertedWith(
          "StakingModule: Cannot exit in the same block as another stake or exit"
        )
      })
    })
  })

  describe("stakeFor", () => {
    // don't feel the need to test this too extensively
    const bobAmtStake = 50

    beforeEach(async () => {
      await telContract
        .connect(deployer)
        .transfer(migrator.address, bobAmtStake)
      expect(await telContract.balanceOf(migrator.address)).to.equal(
        bobAmtStake
      )

      await stakingContract
        .connect(deployer)
        .grantRole(MIGRATOR_ROLE, migrator.address)

      await telContract
        .connect(migrator)
        .approve(stakingContract.address, ethers.constants.MaxUint256)
    })

    describe("when called by non migrator role holder", () => {
      it("should fail", async () => {
        await expect(
          stakingContract.connect(deployer).stakeFor(bob.address, 1)
        ).to.be.revertedWith("AccessControl: account " + (deployer.address).toLowerCase() + " is missing role " + MIGRATOR_ROLE)
      })
    })

    describe("when called by migrator role holder", () => {
      let stakeTxPromise

      beforeEach(async () => {
        await telContract
          .connect(migrator)
          .approve(stakingContract.address, ethers.constants.MaxUint256)
        stakeTxPromise = stakingContract
          .connect(migrator)
          .stakeFor(bob.address, bobAmtStake)
        await stakeTxPromise
      })

      it("should move tokens from migrator to StakingModule", async () => {
        expect(await telContract.balanceOf(stakingContract.address)).to.equal(
          bobAmtStake
        )
        expect(await telContract.balanceOf(migrator.address)).to.equal(0)
      })

      it("should update balanceOf(Bob) and stakedBy(Bob)", async () => {
        expect(await stakingContract.balanceOf(bob.address, "0x")).to.equal(
          bobAmtStake
        )
        expect(await stakingContract.stakedBy(bob.address)).to.equal(
          bobAmtStake
        )
      })

      it("should emit StakeChanged", async () => {
        await expect(stakeTxPromise).to.emit(stakingContract, "StakeChanged")
      })
    })
  })

  describe("claimAndExitFor", () => {
    // don't feel the need to test this too extensively
    const bobAmtStake = 50

    beforeEach(async () => {
      await telContract.connect(deployer).transfer(bob.address, bobAmtStake)
      expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtStake)

      await telContract
        .connect(bob)
        .approve(stakingContract.address, ethers.constants.MaxUint256)
      await stakingContract.connect(bob).stake(bobAmtStake)
    })

    describe("when there is no active migrator", () => {
      it("should fail", async () => {
        await expect(
          stakingContract
            .connect(migrator)
            .claimAndExitFor(bob.address, charlie.address, "0x")
        ).to.be.revertedWith(`AccessControl: account ${migrator.address.toLowerCase()} is missing role ${MIGRATOR_ROLE}`)
      })
    })

    describe("when a migrator has been set", () => {
      beforeEach(async () => {
        await stakingContract
          .connect(deployer)
          .grantRole(MIGRATOR_ROLE, migrator.address)
      })

      describe("when caller is not migrator", () => {
        it("should fail", async () => {
          await expect(
            stakingContract
              .connect(deployer)
              .claimAndExitFor(bob.address, charlie.address, "0x")
          ).to.be.revertedWith(`AccessControl: account ${deployer.address.toLowerCase()} is missing role ${MIGRATOR_ROLE}`)
        })
      })

      describe("when caller is migrator", () => {
        let stakeTxPromise

        beforeEach(async () => {
          stakeTxPromise = stakingContract
            .connect(migrator)
            .claimAndExitFor(bob.address, charlie.address, "0x")
          await stakeTxPromise
        })

        it("should move tokens from StakingModule to Charlie", async () => {
          expect(await telContract.balanceOf(charlie.address)).to.equal(
            bobAmtStake
          )
          expect(await telContract.balanceOf(migrator.address)).to.equal(0)
          expect(
            await telContract.balanceOf(stakingContract.address)
          ).to.equal(0)
        })

        it("should update balanceOf(Bob) and stakedBy(Bob)", async () => {
          expect(await stakingContract.balanceOf(bob.address, "0x")).to.equal(0)
          expect(await stakingContract.stakedBy(bob.address)).to.equal(0)
        })

        it("should emit StakeChanged", async () => {
          await expect(stakeTxPromise).to.emit(stakingContract, "StakeChanged")
        })
      })
    })
  })

  describe("setWithdrawalDelayAndWindow", () => {
    let maxWithdrawalDelay
    let minWithdrawalWindow

    beforeEach(async () => {
      await stakingContract
        .connect(deployer)
        .grantRole(SLASHER_ROLE, slasher.address)
      maxWithdrawalDelay = await stakingContract.maxWithdrawalDelay()
      minWithdrawalWindow = await stakingContract.minWithdrawalWindow()
    })

    it("should fail when called by non slasher", async () => {
      await expect(
        stakingContract.connect(deployer).setWithdrawDelayAndWindow(0, 60)
      ).to.be.revertedWith("AccessControl: account " + (deployer.address).toLowerCase() + " is missing role " + SLASHER_ROLE)
    })

    it("should fail if delay is too long", async () => {
      await expect(
        stakingContract
          .connect(slasher)
          .setWithdrawDelayAndWindow(
            maxWithdrawalDelay.add(1),
            minWithdrawalWindow
          )
      ).to.be.revertedWith("StakingModule: Desired delay is too long")
    })

    it("should fail if window is too short", async () => {
      await expect(
        stakingContract
          .connect(slasher)
          .setWithdrawDelayAndWindow(
            maxWithdrawalDelay,
            minWithdrawalWindow.sub(1)
          )
      ).to.be.revertedWith("StakingModule: Desired window is too short")
    })

    it("should fail if window + delay is too long", async () => {
      const ts = await helpers.time.latest()
      await expect(
        stakingContract
          .connect(slasher)
          .setWithdrawDelayAndWindow(
            maxWithdrawalDelay,
            1 + ts - Number(maxWithdrawalDelay)
          )
      ).to.be.revertedWith("StakingModule: Desired window + delay is too large")
    })

    it("should set delay and window appropriately if they are within bounds", async () => {
      await stakingContract
        .connect(slasher)
        .setWithdrawDelayAndWindow(maxWithdrawalDelay, minWithdrawalWindow)

      expect(await stakingContract.withdrawalDelay()).to.equal(
        maxWithdrawalDelay
      )
      expect(await stakingContract.withdrawalWindow()).to.equal(
        minWithdrawalWindow
      )
    })
  })

  describe("slash", () => {
    const charlieInitialBalance = 200
    const charlieAmtStake = 23

    beforeEach("make charlie stake and grant slasher role", async () => {
      await telContract
        .connect(deployer)
        .transfer(charlie.address, charlieInitialBalance)
      await telContract
        .connect(charlie)
        .approve(stakingContract.address, ethers.constants.MaxUint256)

      await stakingContract.connect(charlie).stake(charlieAmtStake)

      await stakingContract
        .connect(deployer)
        .grantRole(SLASHER_ROLE, slasher.address)
    })

    describe("when called by non-slasher", () => {
      let slashTxPromise

      beforeEach(async () => {
        slashTxPromise = stakingContract
          .connect(deployer)
          .slash(bob.address, 1, stakingContract.address, emptyBytes)
      })

      it("should fail", async () => {
        await expect(slashTxPromise).to.be.revertedWith("AccessControl: account " + (deployer.address).toLowerCase() + " is missing role " + SLASHER_ROLE)
      })
    })

    describe("when called by slasher", () => {
      describe("when slashed user has no stake", () => {
        it("should fail", async () => {
          let slashTxPromise = stakingContract
            .connect(slasher)
            .slash(bob.address, 1, stakingContract.address, emptyBytes)

          await expect(slashTxPromise).to.be.revertedWith(
            "Account has insufficient balance"
          )
        })
      })

      describe("when slashed user has some stake", () => {
        const bobInitialBalance = 100
        const bobAmtStake = 20

        beforeEach(async () => {
          await telContract
            .connect(deployer)
            .transfer(bob.address, bobInitialBalance)
          await telContract
            .connect(bob)
            .approve(stakingContract.address, ethers.constants.MaxUint256)
          await stakingContract.connect(bob).stake(bobAmtStake)
        })

        describe("when slashed amount is too big", () => {
          it("should fail", async () => {
            await expect(
              stakingContract
                .connect(slasher)
                .slash(
                  bob.address,
                  bobAmtStake + 1,
                  slashCollector.address,
                  emptyBytes
                )
            ).to.be.revertedWith("Account has insufficient balance")
          })
        })

        describe("when slashed amount is equal to staked amount", () => {
          let slashTx
          beforeEach(async () => {
            slashTx = await stakingContract
              .connect(slasher)
              .slash(
                bob.address,
                bobAmtStake,
                slashCollector.address,
                emptyBytes
              )
          })

          it("should emit Slashed and StakeChanged", () => {
            expect(slashTx).to.emit(stakingContract, "Slashed")
            expect(slashTx).to.emit(stakingContract, "StakeChanged")
          })

          it("should leave slashCollector with tel", async () => {
            expect(
              await telContract.balanceOf(slashCollector.address)
            ).to.equal(bobAmtStake)
          })

          it("should leave stakingContract with only charlie's stake worth of tel", async () => {
            expect(
              await telContract.balanceOf(stakingContract.address)
            ).to.equal(charlieAmtStake)
          })

          it("balanceOf(bob), stakedBy(bob) should be 0", async () => {
            expect(
              await stakingContract.balanceOf(bob.address, emptyBytes)
            ).to.equal(0)
            expect(await stakingContract.stakedBy(bob.address)).to.equal(0)
          })
        })

        describe("when slashed amount is less than staked amount", () => {
          let slashTx
          beforeEach(async () => {
            slashTx = await stakingContract
              .connect(slasher)
              .slash(
                bob.address,
                bobAmtStake - 1,
                slashCollector.address,
                emptyBytes
              )
          })

          it("should emit Slashed and StakeChanged", () => {
            expect(slashTx).to.emit(stakingContract, "Slashed")
            expect(slashTx).to.emit(stakingContract, "StakeChanged")
          })

          it("should leave slashCollector with tel", async () => {
            expect(
              await telContract.balanceOf(slashCollector.address)
            ).to.equal(bobAmtStake - 1)
          })

          it("should leave stakingContract with 1 + charlie's stake worth of tel", async () => {
            expect(
              await telContract.balanceOf(stakingContract.address)
            ).to.equal(1 + charlieAmtStake)
          })

          it("balanceOf(bob), stakedBy(bob) should be 1", async () => {
            expect(
              await stakingContract.balanceOf(bob.address, emptyBytes)
            ).to.equal(1)
            expect(await stakingContract.stakedBy(bob.address)).to.equal(1)
          })
        })
      })
    })
  })

  async function checkPluginIndiciesMapping() {
    const nPlugins = await stakingContract.nPlugins()
    for (let i = 0; i < nPlugins.toNumber(); i++) {
      const plugin = await stakingContract.plugins(i)
      expect(await stakingContract.pluginIndicies(plugin)).to.equal(i)
    }
  }

  describe("addPlugin", () => {
    describe("when called by non-editor", () => {
      it("should fail", async () => {
        await expect(
          stakingContract.connect(deployer).addPlugin(charlie.address)
        ).to.be.revertedWith("AccessControl: account " + (deployer.address).toLowerCase() + " is missing role " + PLUGIN_EDITOR_ROLE)
      })
    })

    describe("when called by editor", () => {
      const nPlugins = 3
      let plugins
      const txs = []

      beforeEach(async () => {
        plugins = await deployNMockPlugins(nPlugins)

        await stakingContract
          .connect(deployer)
          .grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)

        for (let i = 0; i < nPlugins; i++) {
          txs.push(
            await stakingContract
              .connect(pluginEditor)
              .addPlugin(plugins[i].address)
          )
        }
      })

      it("should emit the correct events", async () => {
        for (let i = 0; i < nPlugins; i++) {
          expect(txs[i]).to.emit(stakingContract, "PluginAdded")
        }
      })

      it("should add the correct number of plugins", async () => {
        expect(await stakingContract.plugins(nPlugins - 1)).to.equal(plugins[2].address)
        await expect(stakingContract.plugins(nPlugins)).to.be.reverted

        expect(await stakingContract.nPlugins()).to.equal(nPlugins)
      })

      it("should add the right values for plugins", async () => {
        for (let i = 0; i < nPlugins; i++) {
          expect(await stakingContract.plugins(i)).to.equal(plugins[i].address)
        }
      })

      it("should update the plugins mapping", async () => {
        for (let i = 0; i < nPlugins; i++) {
          expect(
            await stakingContract.pluginsMapping(plugins[i].address)
          ).to.equal(true)
        }
      })

      it("should update the pluginIndicies mapping", async () => {
        await checkPluginIndiciesMapping()
      })

      describe("when adding a plugin that already exists", () => {
        let txPromise

        beforeEach(async () => {
          txPromise = stakingContract
            .connect(pluginEditor)
            .addPlugin(plugins[0].address)
        })

        it("should fail", async () => {
          await expect(txPromise).to.be.revertedWith(
            "StakingModule::addPlugin: Cannot add an existing plugin"
          )
        })
      })

      describe("when adding a plugin without correct interface", () => {
        let txPromise

        beforeEach(async () => {
          await plugins[0].setShouldRevert(true)
          txPromise = stakingContract
            .connect(pluginEditor)
            .addPlugin(plugins[0].address)
        })

        it("should fail", async () => {
          await expect(txPromise).to.be.revertedWith(
            "StakingModule::addPlugin: plugin does not support IPlugin"
          )
        })
      })

      describe("when adding a deactivated plugin", () => {
        let txPromise

        beforeEach(async () => {
          await plugins[0].setBAns(true)
          txPromise = stakingContract
            .connect(pluginEditor)
            .addPlugin(plugins[0].address)
        })

        it("should fail", async () => {
          await expect(txPromise).to.be.revertedWith(
            "StakingModule::addPlugin: Cannot add deactivated plugin"
          )
        })
      })
    })
  })

  describe("removePlugin", () => {
    const nPlugins = 3
    let plugins

    beforeEach(async () => {
      plugins = await deployNMockPlugins(nPlugins)
    })

    describe("when called by non-editor", () => {
      it("should fail", async () => {
        await expect(
          stakingContract.connect(deployer).removePlugin(charlie.address)
        ).to.be.revertedWith("AccessControl: account " + (deployer.address).toLowerCase() + " is missing role " + PLUGIN_EDITOR_ROLE)
      })
    })

    describe("when called by editor", () => {
      beforeEach(async () => {
        await stakingContract
          .connect(deployer)
          .grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)
      })

      describe("when no plugins have been added", () => {
        it("should fail", async () => {
          await expect(stakingContract.connect(pluginEditor).removePlugin(0)).to.be.reverted
          await expect(stakingContract.connect(pluginEditor).removePlugin(1)).to.be.reverted
          let failed = false
          try {
            await expect(stakingContract.connect(pluginEditor).removePlugin(-1)).to.be.reverted
          } catch (error) {
            failed = true
          }
          assert(failed)
        })
      })

      describe("when some plugins have been added", () => {
        beforeEach(async () => {
          for (let i = 0; i < nPlugins; i++) {
            await stakingContract
              .connect(pluginEditor)
              .addPlugin(plugins[i].address)
          }
        })

        describe("when a plugin out of bounds is removed", () => {
          it("should fail", async () => {
            await expect(
              stakingContract.connect(pluginEditor).removePlugin(nPlugins)
            ).to.be.reverted
          })
        })

        describe("when a plugin that is not deactivated is removed", () => {
          it("should fail", async () => {
            await expect(
              stakingContract.connect(pluginEditor).removePlugin(0)
            ).to.be.revertedWith(
              "StakingModule::removePlugin: Plugin is not deactivated"
            )
          })
        })

        describe("when the first plugin is removed", () => {
          beforeEach(async () => {
            await plugins[0].setBAns(true)
            await stakingContract.connect(pluginEditor).removePlugin(0)
          })

          it("should remove exactly one plugin", async () => {
            expect(await stakingContract.plugins(nPlugins - 2)).to.equal(plugins[1].address)
            await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted

            expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1)
          })

          it("should remove the first one", async () => {
            for (let i = 0; i < nPlugins - 1; i++) {
              expect(await stakingContract.plugins(i)).to.not.equal(
                plugins[0].address
              )
            }
          })

          it("should update the plugins mapping", async () => {
            expect(
              await stakingContract.pluginsMapping(plugins[0].address)
            ).to.equal(false)
          })

          it("should update the pluginIndicies mapping", async () => {
            await checkPluginIndiciesMapping()
          })
        })

        describe("when the second plugin is removed", () => {
          beforeEach(async () => {
            await plugins[1].setBAns(true)
            await stakingContract.connect(pluginEditor).removePlugin(1)
          })

          it("should remove exactly one plugin", async () => {
            expect(await stakingContract.plugins(nPlugins - 2)).to.equal(plugins[2].address)
            await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted

            expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1)
          })

          it("should remove the second one", async () => {
            for (let i = 0; i < nPlugins - 1; i++) {
              expect(await stakingContract.plugins(i)).to.not.equal(plugins[1])
            }
          })

          it("should update the plugins mapping", async () => {
            expect(
              await stakingContract.pluginsMapping(plugins[1].address)
            ).to.equal(false)
          })

          it("should update the pluginIndicies mapping", async () => {
            await checkPluginIndiciesMapping()
          })
        })

        describe("when the last plugin is removed", () => {
          beforeEach(async () => {
            await plugins[nPlugins - 1].setBAns(true)
            await stakingContract
              .connect(pluginEditor)
              .removePlugin(nPlugins - 1)
          })

          it("should remove exactly one plugin", async () => {
            expect(await stakingContract.plugins(nPlugins - 2)).to.not.be
              .reverted
            await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted

            expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1)
          })

          it("should remove the last one", async () => {
            for (let i = 0; i < nPlugins - 1; i++) {
              expect(await stakingContract.plugins(i)).to.not.equal(
                plugins[nPlugins - 1]
              )
            }
          })

          it("should update the plugins mapping", async () => {
            expect(
              await stakingContract.pluginsMapping(
                plugins[nPlugins - 1].address
              )
            ).to.equal(false)
          })

          it("should update the pluginIndicies mapping", async () => {
            await checkPluginIndiciesMapping()
          })
        })
      })
    })
  })

  describe("rescueTokens", () => {
    const bobAmtStake = 100
    const extraTelAmt = 10
    const extraOtherTokenAmt = 20
    let otherTokenContract

    beforeEach(async () => {
      // some user has stake
      await telContract.connect(deployer).transfer(bob.address, bobAmtStake)
      await telContract
        .connect(bob)
        .approve(stakingContract.address, ethers.constants.MaxUint256)
      await stakingContract.connect(bob).stake(bobAmtStake)

      // send some extra TEL
      await telContract
        .connect(deployer)
        .transfer(stakingContract.address, extraTelAmt)

      // send some non-TEL tokens
      const TELFactory = await ethers.getContractFactory("TestTelcoin", deployer)
      otherTokenContract = await TELFactory.deploy(deployer.address)

      await otherTokenContract
        .connect(deployer)
        .transfer(stakingContract.address, extraOtherTokenAmt)

      await stakingContract
        .connect(deployer)
        .grantRole(
          await stakingContract.RECOVERY_ROLE(),
          recoveryRoleHolder.address
        )
    })

    describe("when called by non-recovery role", () => {
      it("should fail", async () => {
        await expect(
          stakingContract
            .connect(bob)
            .rescueTokens(telContract.address, bob.address)
        ).to.be.revertedWith("AccessControl: account " + (bob.address).toLowerCase() + " is missing role " + RECOVERY_ROLE)
      })
    })

    describe("when called by recovery", () => {
      describe("when rescuing TEL", () => {
        it("should return ONLY the extra amount, not everything in the contract", async () => {
          const balBefore = await telContract.balanceOf(charlie.address)
          await stakingContract
            .connect(recoveryRoleHolder)
            .rescueTokens(telContract.address, charlie.address)
          const balAfter = await telContract.balanceOf(charlie.address)

          expect(balAfter.sub(balBefore)).to.equal(extraTelAmt)
          expect(await telContract.balanceOf(stakingContract.address)).to.equal(
            bobAmtStake
          )
        })
      })

      describe("when rescuing non-TEL", () => {
        it("should return entire balance of contract", async () => {
          const balBefore = await otherTokenContract.balanceOf(charlie.address)
          await stakingContract
            .connect(recoveryRoleHolder)
            .rescueTokens(otherTokenContract.address, charlie.address)
          const balAfter = await otherTokenContract.balanceOf(charlie.address)

          expect(balAfter.sub(balBefore)).to.equal(extraOtherTokenAmt)
          expect(
            await otherTokenContract.balanceOf(stakingContract.address)
          ).to.equal(0)
        })
      })
    })
  })

  describe("faulty plugin", () => {
    describe("when plugin's claim and notifyStakeChange functions do not work", () => {
      const bobAmt = 100

      beforeEach(async () => {
        const plugin = (await deployNMockPlugins(1))[0]

        await stakingContract
          .connect(deployer)
          .grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)
        await stakingContract.connect(pluginEditor).addPlugin(plugin.address)

        await telContract.connect(deployer).transfer(bob.address, bobAmt)
        await telContract
          .connect(bob)
          .approve(stakingContract.address, ethers.constants.MaxUint256)

        await plugin.setShouldRevert(true)
        await plugin.setBAns(true)
      })

      describe("when staking", () => {
        let txPromise
        beforeEach(async () => {
          txPromise = stakingContract.connect(bob).stake(bobAmt)
          await txPromise
        })

        it("should not fail and emit StakeChangeNotificationFailed", async () => {
          await expect(txPromise).to.not.be.reverted
          await expect(txPromise).to.emit(
            stakingContract,
            "StakeChangeNotificationFailed"
          )
        })

        it("should still increase staking.balanceOf(bob)", async () => {
          expect(
            await stakingContract.balanceOf(bob.address, emptyBytes)
          ).to.equal(bobAmt)
        })

        describe("when claiming and exiting", () => {
          let txPromise
          beforeEach(async () => {
            txPromise = stakingContract
              .connect(bob)
              .fullClaimAndExit(emptyBytes)
            await txPromise
          })

          it("should not fail and emit PluginClaimFailed and StakeChangeNotificationFailed", async () => {
            await expect(txPromise).to.not.be.reverted
            await expect(txPromise).to.emit(
              stakingContract,
              "PluginClaimFailed"
            )
            await expect(txPromise).to.emit(
              stakingContract,
              "StakeChangeNotificationFailed"
            )
          })

          it("should still 0 out staking.balanceOf(bob)", async () => {
            expect(
              await stakingContract.balanceOf(bob.address, emptyBytes)
            ).to.equal(0)
          })
        })
      })
    })
  })

  describe("parseAuxData", () => {
    function createAuxData(headerItems, payload) {
      return new ethers.utils.AbiCoder().encode(
        ["struct(address addr, uint256 start, uint256 len)[]", "bytes"],
        [headerItems, payload]
      )
    }

    const payload = "0x010203040506070809"
    const nPlugins = 3
    let plugins

    beforeEach(async () => {
      plugins = await deployNMockPlugins(nPlugins)

      await stakingContract
        .connect(deployer)
        .grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)

      for (let i = 0; i < nPlugins; i++) {
        await stakingContract
          .connect(pluginEditor)
          .addPlugin(plugins[i].address)
      }
    })

    describe("when one of the HeaderItems has an invalid plugin", () => {
      it("should fail", async () => {
        const headerItems = [
          { addr: plugins[0].address, start: 0, len: 2 },
          { addr: ethers.Wallet.createRandom().address, start: 2, len: 1 }
        ]

        const auxData = createAuxData(headerItems, payload)

        await expect(stakingContract.parseAuxData(auxData)).to.be.revertedWith(
          "StakingModule: Invalid Plugin when parsing auxData"
        )
      })
    })

    describe("when the range specified in a HeaderItem is out of bounds of payload", () => {
      it("should fail", async () => {
        const headerItems = [
          { addr: plugins[0].address, start: 0, len: 2 },
          { addr: plugins[0].address, start: 2, len: 100 }
        ]

        const auxData = createAuxData(headerItems, payload)

        await expect(stakingContract.parseAuxData(auxData)).to.be.revertedWith(
          "slice_outOfBounds"
        )
      })
    })

    describe("when empty auxData is provided", () => {
      it("should return an array of length nPlugins. Each element in the array is empty bytes", async () => {
        const ret = await stakingContract.parseAuxData(emptyBytes)
        expect(ret.length).to.equal(nPlugins)
        for (let i = 0; i < ret.length; i++) {
          expect(ret[i]).to.equal("0x")
        }
      })
    })

    describe("when there are valid header items", () => {
      describe("when the number of header items is less than nPlugins", () => {
        it("should correctly parse", async () => {
          const headerItems = [
            { addr: plugins[0].address, start: 0, len: 2 },
            { addr: plugins[nPlugins - 1].address, start: 2, len: 5 }
          ]

          const auxData = createAuxData(headerItems, payload)

          const response = await stakingContract.parseAuxData(auxData)

          expect(response.length).to.equal(nPlugins)

          for (let i = 0; i < nPlugins; i++) {
            if (i == 0) {
              expect(response[i]).to.equal(
                "0x" +
                payload
                  .substring(2)
                  .substring(
                    headerItems[0].start * 2,
                    headerItems[0].start * 2 + 2 * headerItems[0].len
                  )
              )
            } else if (i == nPlugins - 1) {
              expect(response[i]).to.equal(
                "0x" +
                payload
                  .substring(2)
                  .substring(
                    headerItems[1].start * 2,
                    headerItems[1].start * 2 + 2 * headerItems[1].len
                  )
              )
            } else {
              expect(response[i]).to.equal("0x")
            }
          }
        })
      })
    })
  })
})
