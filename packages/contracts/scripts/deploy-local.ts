import hre from "hardhat";

const { ethers } = hre;

process.stdout.write("deploy-local: script loaded\n");

const BASE_FEE = ethers.parseEther("0.1");
const GAS_PRICE_LINK = 1_000_000_000n;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deploy-local: main start");
  console.log("Deployer:", deployer.address);

  const VrfMockFactory = await ethers.getContractFactory("VRFCoordinatorV2Mock");
  const vrfMock = await VrfMockFactory.deploy(BASE_FEE, GAS_PRICE_LINK);
  await vrfMock.waitForDeployment();

  const createSubTx = await vrfMock.createSubscription();
  const createSubReceipt = await createSubTx.wait();
  const subId = createSubReceipt?.logs?.[0]?.args?.subId || 1n;

  await vrfMock.fundSubscription(subId, ethers.parseEther("10"));

  const AgentMarket = await ethers.getContractFactory("AgentMarket");
  const contract = await AgentMarket.deploy(deployer.address, await vrfMock.getAddress());
  await contract.waitForDeployment();

  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("local-key-hash"));
  const setConfigTx = await contract.setVrfConfig(keyHash, subId, 3, 200000);
  await setConfigTx.wait();
  const addConsumerTx = await vrfMock.addConsumer(subId, await contract.getAddress());
  await addConsumerTx.wait();

  const vrfAddress = await vrfMock.getAddress();
  const contractAddress = await contract.getAddress();

  console.log("VRF_COORDINATOR:", vrfAddress);
  console.log("VRF_SUBSCRIPTION_ID:", subId.toString());
  console.log("CONTRACT_ADDRESS:", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
