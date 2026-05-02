import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const vrfCoordinator = process.env.VRF_COORDINATOR;
  const keyHash = process.env.VRF_KEY_HASH;
  const subId = process.env.VRF_SUBSCRIPTION_ID;

  if (!vrfCoordinator || !keyHash || !subId) {
    throw new Error("VRF_COORDINATOR, VRF_KEY_HASH, and VRF_SUBSCRIPTION_ID are required");
  }

  const AgentMarket = await ethers.getContractFactory("AgentMarket");
  const contract = await AgentMarket.deploy(treasury, vrfCoordinator);
  await contract.waitForDeployment();

  const confirmations = process.env.VRF_CONFIRMATIONS ? Number(process.env.VRF_CONFIRMATIONS) : 3;
  const callbackGas = process.env.VRF_CALLBACK_GAS_LIMIT ? Number(process.env.VRF_CALLBACK_GAS_LIMIT) : 200000;

  await contract.setVrfConfig(keyHash, BigInt(subId), confirmations, callbackGas);

  console.log("Network:", network.name);
  console.log("AgentMarket:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
