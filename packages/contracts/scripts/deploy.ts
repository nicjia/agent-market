import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const vrfCoordinator = process.env.VRF_COORDINATOR;

  if (!vrfCoordinator) {
    throw new Error("VRF_COORDINATOR is required for deployment");
  }

  const AgentMarket = await ethers.getContractFactory("AgentMarket");
  const contract = await AgentMarket.deploy(treasury, vrfCoordinator);
  await contract.waitForDeployment();

  console.log("AgentMarket deployed to:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
