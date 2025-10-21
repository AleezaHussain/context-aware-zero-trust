// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 Context-Aware Smart Contract with:
  • Owner and minimal RBAC (ADMIN/REGISTRAR)
  • Device authorization
  • Signed context payloads (to support Zero Trust)
  • Struct-based payload to fix “stack too deep”
*/

contract ContextManager {
    // ----- State -----
    uint public temperature;
    uint public humidity;
    uint public totalMeterSignal;
    uint public totalDevicesPowerValue;
    uint public ac1Power;
    uint public ac2Power;
    uint public ac3Power;
    uint public carBatteryPowerStatus;
    uint public hour;
    address public owner;

    // ----- Roles -----
    bytes32 public ADMIN_ROLE;
    bytes32 public REGISTRAR_ROLE;
    bytes32 public GATEWAY_ROLE;
    mapping(bytes32 => mapping(address => bool)) public roles;

    // ----- Authorization -----
    mapping(address => bool) public authorizedDevice;
    mapping(address => uint) public nonces;

    // ----- Events -----
    // Legacy context event removed — this contract now performs device verification only
    event DeviceVerified();

    event DeviceAuthorized(address device);
    event DeviceDeauthorized(address device);

    // --- Step 3: Context events ---
    event ContextUpdated(address indexed device, bytes32 contextHash, uint256 timestamp);
    event ContextViolation(address indexed device, string reason, uint256 timestamp);
    // --- Step 3: Context state ---
    mapping(address => bytes32) public lastContext;

    // ----- Constructor -----
    constructor() {
        owner = msg.sender;
        ADMIN_ROLE = keccak256(abi.encodePacked("ADMIN_ROLE"));
        REGISTRAR_ROLE = keccak256(abi.encodePacked("REGISTRAR_ROLE"));
        GATEWAY_ROLE = keccak256(abi.encodePacked("GATEWAY_ROLE"));
        roles[ADMIN_ROLE][msg.sender] = true;
        roles[REGISTRAR_ROLE][msg.sender] = true;
        roles[GATEWAY_ROLE][msg.sender] = true; // owner can initially act as gateway
    }

    // ----- Modifiers -----
    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyRole(bytes32 role) {
        require(roles[role][msg.sender], "missing role");
        _;
    }

    // ----- Ownership -----
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid address");
        owner = newOwner;
    }

    // ----- Role Management -----
    function grantRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        roles[role][account] = true;
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        roles[role][account] = false;
    }

    // ----- Device Authorization -----
    function authorizeDevice(address device) external onlyRole(REGISTRAR_ROLE) {
        authorizedDevice[device] = true;
        emit DeviceAuthorized(device);
    }

    function deauthorizeDevice(address device) external onlyRole(REGISTRAR_ROLE) {
        authorizedDevice[device] = false;
        emit DeviceDeauthorized(device);
    }

    // ----- Struct to fix stack depth -----
    struct ContextPayload {
    uint temperature;
    uint humidity;
    uint totalMeterSignal;
    uint totalDevicesPowerValue;
    uint hour;
    uint ac1Power;
    uint ac2Power;
    uint ac3Power;
    uint carBatteryPowerStatus;
    uint nonce;
    bytes32 contextHash; // Step 3: add contextHash to payload
    }

    // ----- Signed Context Submission -----
    function setContextDataSigned(
        ContextPayload calldata data,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // Hash the struct safely — using abi.encode ensures unique encoding
        bytes32 hash = keccak256(
            abi.encode(
                data.temperature,
                data.humidity,
                data.totalMeterSignal,
                data.totalDevicesPowerValue,
                data.hour,
                data.ac1Power,
                data.ac2Power,
                data.ac3Power,
                data.carBatteryPowerStatus,
                data.nonce,
                address(this),
                data.contextHash
            )
        );

    // match web3.eth.accounts.sign which prefixes the message
    bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    address signer = ecrecover(prefixed, v, r, s);
        require(signer != address(0), "invalid signature");
        require(authorizedDevice[signer], "device not authorized");
        require(nonces[signer] == data.nonce, "invalid nonce");

    // Zero-Trust only: we DO NOT store the contextual attributes on-chain here.
    // Advance nonce to prevent replay and emit a minimal verification event.
    nonces[signer] = data.nonce + 1;
    emit DeviceVerified();
    }

    // ----- Gateway-submitted context (Zero-Trust envelope) -----
    // Gateway calls this function on behalf of a device. The gateway must
    // have GATEWAY_ROLE. The device signature is included so the contract can
    // verify device authenticity and maintain per-device nonces while keeping
    // the device identity out of public storage (i.e., the contract does not
    // write the recovered device address to storage or emit it in events).
    function setContextDataViaGateway(
        ContextPayload calldata data,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(GATEWAY_ROLE) {
        // Recreate signed hash the same way as device-signed submissions
        bytes32 hash = keccak256(
            abi.encode(
                data.temperature,
                data.humidity,
                data.totalMeterSignal,
                data.totalDevicesPowerValue,
                data.hour,
                data.ac1Power,
                data.ac2Power,
                data.ac3Power,
                data.carBatteryPowerStatus,
                data.nonce,
                address(this),
                data.contextHash
            )
        );
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = ecrecover(prefixed, v, r, s);
        require(recovered != address(0), "invalid device signature");
        require(authorizedDevice[recovered], "device not authorized");
        require(nonces[recovered] == data.nonce, "invalid nonce");

        // --- Step 3: Context deviation check ---
        if (lastContext[recovered] != bytes32(0) && lastContext[recovered] != data.contextHash) {
            emit ContextViolation(recovered, "Context deviation detected", block.timestamp);
        }
        // Update stored context hash
        lastContext[recovered] = data.contextHash;
        // Emit context update event
        emit ContextUpdated(recovered, data.contextHash, block.timestamp);

        // Advance nonce to prevent replays and emit a concise verification event.
        nonces[recovered] = data.nonce + 1;
        emit DeviceVerified();
    }

    // ----- Basic owner setter (optional) -----
    function setContextData(
        uint _temperature,
        uint _humidity,
        uint _totalMeterSignal,
        uint _totalDevicesPowerValue,
        uint _hour,
        uint _ac1Power,
        uint _ac2Power,
        uint _ac3Power,
        uint _carBatteryPowerStatus
    ) external onlyOwner {
        // Validate sensible ranges for owner-set data as well
        require(_temperature <= 100, "temperature out of range (0-100)");
        require(_humidity <= 100, "humidity out of range (0-100)");

        temperature = _temperature;
        humidity = _humidity;
        hour = _hour;
        totalMeterSignal = _totalMeterSignal;
        ac1Power = _ac1Power;
        ac2Power = _ac2Power;
        ac3Power = _ac3Power;
        carBatteryPowerStatus = _carBatteryPowerStatus;
        totalDevicesPowerValue = _totalDevicesPowerValue;

        // emit a minimal verification/acknowledgement event (ContextUpdated removed)
        emit DeviceVerified();
    }

    // ----- Getter -----
    function getContextData()
        external
        view
        returns (uint, uint, uint, uint, uint, uint, uint, uint)
    {
        return (
            temperature,
            humidity,
            hour,
            totalMeterSignal,
            ac1Power,
            ac2Power,
            ac3Power,
            carBatteryPowerStatus
        );
    }
}
