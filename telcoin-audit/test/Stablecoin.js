const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Stablecoin", () => {
  let stablecoin, testtoken, deployer, holder, recipient;

  beforeEach("setup", async () => {
    [deployer, holder, recipient] = await ethers.getSigners();

    const StablecoinFactory = await ethers.getContractFactory("Stablecoin", deployer);
    stablecoin = await StablecoinFactory.deploy();
    await stablecoin.deployed();

    const TestTokenFactory = await ethers.getContractFactory("TestToken", deployer);
    testtoken = await TestTokenFactory.deploy(deployer.address);
    await testtoken.deployed();

    await stablecoin.init("Stablecoin", "S", 18, "A stablecoin pegged to a fiat currency");
    await stablecoin.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("META_ROLE")), deployer.address);
    await stablecoin.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SUPPORT_ROLE")), deployer.address);
    await stablecoin.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BURNER_ROLE")), deployer.address);
    await stablecoin.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BLACKLISTER_ROLE")), deployer.address);
  });

  describe("Static Values", () => {
    describe("Getters", () => {
      it("META_ROLE", async () => {
        expect(await stablecoin.META_ROLE()).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("META_ROLE")));
      });

      it("SUPPORT_ROLE", async () => {
        expect(await stablecoin.SUPPORT_ROLE()).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SUPPORT_ROLE")));
      });

      it("BURNER_ROLE", async () => {
        expect(await stablecoin.BURNER_ROLE()).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BURNER_ROLE")));
      });

      it("BLACKLISTER_ROLE", async () => {
        expect(await stablecoin.BLACKLISTER_ROLE()).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BLACKLISTER_ROLE")));
      });

      it("name", async () => {
        expect(await stablecoin.name()).to.equal("Stablecoin");
      });

      it("symbol", async () => {
        expect(await stablecoin.symbol()).to.equal("S");
      });

      it("decimals", async () => {
        expect(await stablecoin.decimals()).to.equal(18);
      });

      it("description", async () => {
        expect(await stablecoin.description()).to.equal("A stablecoin pegged to a fiat currency");
      });
    });

    describe("Setters", () => {
      it("name", async () => {
        await stablecoin.connect(deployer).updateName("Newcoin")
        expect(await stablecoin.name()).to.equal("Newcoin");
      });

      it("symbol", async () => {
        await stablecoin.connect(deployer).updateSymbol("N")
        expect(await stablecoin.symbol()).to.equal("N");
      });

      it("description", async () => {
        await stablecoin.connect(deployer).updateDescription("Hello, World!")
        expect(await stablecoin.description()).to.equal("Hello, World!");
      });
    });
  });

  describe("Minting and Burning", () => {
    describe("Success", () => {
      it("should mint tokens", async () => {
        await stablecoin.mint(holder.address, ethers.utils.parseEther("1"));
        const balance = await stablecoin.balanceOf(holder.address);
        expect(balance).to.equal(ethers.utils.parseEther("1"));
      });

      it("should burn tokens from user", async () => {
        await stablecoin.mint(holder.address, ethers.utils.parseEther("1"));
        await expect(stablecoin.connect(holder).approve(deployer.address, ethers.utils.parseEther("1"))).to.not.be.reverted;
        await stablecoin.burnFrom(holder.address, ethers.utils.parseEther("1"));
        const balance = await stablecoin.balanceOf(holder.address);
        expect(balance).to.equal(0);
      });
    });

    describe("Failure", () => {
      it("should burn tokens", async () => {
        await stablecoin.mint(deployer.address, ethers.utils.parseEther("1"));
        await stablecoin.burn(ethers.utils.parseEther(".5"));
        const balance = await stablecoin.balanceOf(deployer.address);
        expect(balance).to.equal(ethers.utils.parseEther(".5"));
      });

      it("should not burn tokens from user", async () => {
        await stablecoin.mint(holder.address, ethers.utils.parseEther("1"));
        await expect(stablecoin.burnFrom(holder.address, ethers.utils.parseEther("1"))).to.be.revertedWith("ERC20: insufficient allowance");
        const balance = await stablecoin.balanceOf(holder.address);
        expect(balance).to.equal(ethers.utils.parseEther("1"));
      });
    });
  });

  describe("Blacklisting", () => {
    describe("Adding and Removing", () => {
      describe("Success", () => {
        it("should blacklist an address", async () => {
          await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
          expect(await stablecoin.blacklisted(holder.address)).to.equal(true);
        });

        it("should unblacklist an address", async () => {
          await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
          expect(await stablecoin.blacklisted(holder.address)).to.equal(true);
          await expect(stablecoin.removeBlackList(holder.address)).to.be.not.reverted;
          expect(await stablecoin.blacklisted(holder.address)).to.equal(false);
        });

        it("black funds should be removed", async () => {
          let balance = await stablecoin.balanceOf(deployer.address);
          expect(balance).to.equal(0);
          await stablecoin.mint(holder.address, ethers.utils.parseEther("1"));
          await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
          balance = await stablecoin.balanceOf(holder.address);
          expect(balance).to.equal(0);
          balance = await stablecoin.balanceOf(deployer.address);
          expect(balance).to.equal(ethers.utils.parseEther("1"));
        });
      });

      describe("Failure", () => {
        it("should not blacklist an address", async () => {
          await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
          await expect(stablecoin.addBlackList(holder.address)).to.be.reverted;
        });

        it("should not unblacklist an address", async () => {
          await expect(stablecoin.removeBlackList(holder.address)).to.be.reverted;
          expect(await stablecoin.blacklisted(holder.address)).to.equal(false);
        });
      });
    });

    describe("Blacklist interactions", () => {
      it("should not be mintted funds", async () => {
        await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
        await expect(stablecoin.mint(holder.address, ethers.utils.parseEther("1"))).to.be.revertedWith("Stablecoin: destination cannot be blacklisted address");
      });
  
      it("should not receive funds", async () => {
        await expect(stablecoin.addBlackList(holder.address)).to.be.not.reverted;
        await expect(stablecoin.mint(deployer.address, ethers.utils.parseEther("1"))).to.be.not.reverted;
        await expect(stablecoin.transfer(holder.address, ethers.utils.parseEther("1"))).to.be.revertedWith("Stablecoin: destination cannot be blacklisted address");
      });
    });
  });

    describe("Auxiliary", () => {
      it("erc20Rescue", async () => {
        await expect(testtoken.connect(deployer).transfer(stablecoin.address, 1)).to.not.be.reverted;
        expect(await testtoken.balanceOf(stablecoin.address)).to.equal(1);
        expect(await testtoken.balanceOf(holder.address)).to.equal(0);
        await expect(stablecoin.connect(deployer).erc20Rescue(testtoken.address, holder.address, 1)).to.not.be.reverted;
        expect(await testtoken.balanceOf(holder.address)).to.equal(1);
        expect(await testtoken.balanceOf(stablecoin.address)).to.equal(0);
      });
    });
  });