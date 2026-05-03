require("dotenv/config");
require("@nomicfoundation/hardhat-toolbox");

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

const baseSepoliaRpc = process.env.BASE_SEPOLIA_RPC_URL;
const arbitrumSepoliaRpc = process.env.ARBITRUM_SEPOLIA_RPC_URL;

/** @type {import("hardhat/config").HardhatUserConfig} */
const config = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    baseSepolia: {
      url: baseSepoliaRpc || "",
      accounts: deployerKey ? [deployerKey] : []
    },
    arbitrumSepolia: {
      url: arbitrumSepoliaRpc || "",
      accounts: deployerKey ? [deployerKey] : []
    }
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      }
    ]
  }
};

module.exports = config;
