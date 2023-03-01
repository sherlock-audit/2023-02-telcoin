const { expect } = require("chai")

describe("RootBridgeRelay", () => {
    beforeEach('setup', async () => {
        [deployer, holder, ...recipients] = await ethers.getSigners();

        const TelcoinFactory = await ethers.getContractFactory("TestTelcoin", deployer);
        telcoin = await TelcoinFactory.deploy(deployer.address);
        await telcoin.deployed();

        const TestTokenFactory = await ethers.getContractFactory("TestToken", deployer);
        matic = await TestTokenFactory.deploy(deployer.address);
        await matic.deployed();

        const TestPredicate = await ethers.getContractFactory("TestPredicate", deployer);
        predicate = await TestPredicate.deploy();
        await predicate.deployed();

        const TestPOSBridge = await ethers.getContractFactory("TestPOSBridge", deployer);
        testPOSBridge = await TestPOSBridge.deploy(predicate.address);
        await testPOSBridge.deployed();

        const RootBridgeRelay = await ethers.getContractFactory("TestRootBridgeRelay", deployer);
        rootBridgeRelay = await RootBridgeRelay.deploy(matic.address, testPOSBridge.address, predicate.address, deployer.address);
        await rootBridgeRelay.deployed();
    });

    describe("Static Values", () => {
        it("MATIC_ADDRESS", async () => {
            expect(await rootBridgeRelay.MATIC_ADDRESS()).to.equal(matic.address);
        });

        it("POS_BRIDGE", async () => {
            expect(await rootBridgeRelay.POS_BRIDGE()).to.equal(testPOSBridge.address);
        });

        it("PREDICATE_ADDRESS", async () => {
            expect(await rootBridgeRelay.PREDICATE_ADDRESS()).to.equal(predicate.address);
        });

        it("ETHER_ADDRESS", async () => {
            expect(await rootBridgeRelay.ETHER_ADDRESS()).to.equal('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
        });

        it("_owner", async () => {
            expect(await rootBridgeRelay._owner()).to.equal(deployer.address);
        });

        it("recipient", async () => {
            expect(await rootBridgeRelay.recipient()).to.equal(rootBridgeRelay.address);
        });

        it("MAX_INT", async () => {
            expect(await rootBridgeRelay.MAX_INT()).to.equal('115792089237316195423570985008687907853269984665640564039457584007913129639935');
        });
    });

    describe("bridgeTransfer", () => {
        it("transfer MATIC", async () => {
            await deployer.sendTransaction({ to: rootBridgeRelay.address, value: ethers.utils.parseEther("1.0") });
            await expect(rootBridgeRelay.connect(deployer).bridgeTransfer(matic.address)).to.be.reverted;
            expect(await rootBridgeRelay.balanceOf()).to.equal('1000000000000000000');
        });

        it("transferETHToBridge", async () => {
            await deployer.sendTransaction({ to: rootBridgeRelay.address, value: ethers.utils.parseEther("1.0") });
            expect(await rootBridgeRelay.balanceOf()).to.equal('1000000000000000000');
            await expect(rootBridgeRelay.connect(deployer).bridgeTransfer('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).to.not.be.reverted;
            expect(await rootBridgeRelay.balanceOf()).to.equal('0');
        });

        it("transferERCToBridge", async () => {
            await telcoin.connect(deployer).transfer(rootBridgeRelay.address, '1')
            expect(await telcoin.balanceOf(rootBridgeRelay.address)).to.equal(1);
            await expect(rootBridgeRelay.connect(deployer).bridgeTransfer(telcoin.address)).to.not.be.reverted;
            expect(await telcoin.balanceOf(rootBridgeRelay.address)).to.equal(0);
        });

        it("transferERCToBridge with MATIC", async () => {
            await expect(rootBridgeRelay.connect(deployer).bridgeTransfer(matic.address)).to.be.reverted;
        });
    });

    describe("Auxiliary", () => {
        it("erc20Rescue", async () => {
            await expect(matic.connect(deployer).transfer(rootBridgeRelay.address, 1)).to.not.be.reverted;
            expect(await matic.balanceOf(rootBridgeRelay.address)).to.equal(1);
            expect(await matic.balanceOf(holder.address)).to.equal(0);
            await expect(rootBridgeRelay.connect(deployer).erc20Rescue(holder.address, 1)).to.not.be.reverted;
            expect(await matic.balanceOf(holder.address)).to.equal(1);
            expect(await matic.balanceOf(rootBridgeRelay.address)).to.equal(0);
        });

        it("erc20Rescue failure", async () => {
            await expect(matic.connect(deployer).transfer(rootBridgeRelay.address, 1)).to.not.be.reverted;
            expect(await matic.balanceOf(rootBridgeRelay.address)).to.equal(1);
            await expect(rootBridgeRelay.connect(holder).erc20Rescue(holder.address, 1)).to.be.revertedWith("RootBridgeRelay: caller must be owner");
            expect(await matic.balanceOf(rootBridgeRelay.address)).to.equal(1);
        });
    });
});