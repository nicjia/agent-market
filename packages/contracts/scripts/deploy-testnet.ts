import hre from "hardhat";

const { ethers, network } = hre;

process.stdout.write("deploy-testnet: script loaded\n");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const vrfCoordinator = process.env.VRF_COORDINATOR;
  const keyHash = process.env.VRF_KEY_HASH;
  const subId = process.env.VRF_SUBSCRIPTION_ID;

  console.log("deploy-testnet: main start");
  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasury);

  if (!vrfCoordinator || !keyHash || !subId) {
    throw new Error("VRF_COORDINATOR, VRF_KEY_HASH, and VRF_SUBSCRIPTION_ID are required");
  }

  const AgentMarket = await ethers.getContractFactory("AgentMarket");
  const contract = await AgentMarket.deploy(treasury, vrfCoordinator);
  await contract.waitForDeployment();

  const confirmations = process.env.VRF_CONFIRMATIONS ? Number(process.env.VRF_CONFIRMATIONS) : 3;
  const callbackGas = process.env.VRF_CALLBACK_GAS_LIMIT ? Number(process.env.VRF_CALLBACK_GAS_LIMIT) : 200000;

  const setConfigTx = await contract.setVrfConfig(keyHash, BigInt(subId), confirmations, callbackGas);
  await setConfigTx.wait();

  const contractAddress = await contract.getAddress();

  console.log("Network:", network.name);
  console.log("VRF_COORDINATOR:", vrfCoordinator);
  console.log("VRF_SUBSCRIPTION_ID:", subId);
  console.log("VRF_KEY_HASH:", keyHash);
  console.log("CONTRACT_ADDRESS:", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
