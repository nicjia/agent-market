import hre from "hardhat";

const { ethers } = hre;

async function main() {
  const requestId = process.env.VRF_REQUEST_ID;
  const vrfCoordinator = process.env.VRF_COORDINATOR;
  const consumer = process.env.CONTRACT_ADDRESS;

  if (!requestId || !vrfCoordinator || !consumer) {
    throw new Error("VRF_REQUEST_ID, VRF_COORDINATOR, and CONTRACT_ADDRESS are required");
  }

  const VrfMockFactory = await ethers.getContractFactory("VRFCoordinatorV2Mock");
  const vrfMock = VrfMockFactory.attach(vrfCoordinator);

  const tx = await vrfMock.fulfillRandomWords(BigInt(requestId), consumer);
  await tx.wait();
  console.log("fulfilled", requestId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
