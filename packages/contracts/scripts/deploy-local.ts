import { ethers } from "hardhat";

const BASE_FEE = ethers.parseEther("0.1");
const GAS_PRICE_LINK = 1_000_000_000n;

async function main() {
  const [deployer] = await ethers.getSigners();

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
  await contract.setVrfConfig(keyHash, subId, 3, 200000);
  await vrfMock.addConsumer(subId, await contract.getAddress());

  console.log("VRF mock:", await vrfMock.getAddress());
  console.log("Subscription:", subId.toString());
  console.log("AgentMarket:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
