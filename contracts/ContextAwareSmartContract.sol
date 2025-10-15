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
    mapping(bytes32 => mapping(address => bool)) public roles;

    // ----- Authorization -----
    mapping(address => bool) public authorizedDevice;
    mapping(address => uint) public nonces;

    // ----- Events -----
    event ContextUpdated(
        uint temperature,
        uint humidity,
        uint hour,
        uint totalMeterSignal,
        uint ac1Power,
        uint ac2Power,
        uint ac3Power,
        uint carBatteryPowerStatus
    );

    event DeviceAuthorized(address device);
    event DeviceDeauthorized(address device);

    // ----- Constructor -----
    constructor() {
        owner = msg.sender;
        ADMIN_ROLE = keccak256(abi.encodePacked("ADMIN_ROLE"));
        REGISTRAR_ROLE = keccak256(abi.encodePacked("REGISTRAR_ROLE"));
        roles[ADMIN_ROLE][msg.sender] = true;
        roles[REGISTRAR_ROLE][msg.sender] = true;
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
                address(this)
            )
        );

    // match web3.eth.accounts.sign which prefixes the message
    bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    address signer = ecrecover(prefixed, v, r, s);
        require(signer != address(0), "invalid signature");
        require(authorizedDevice[signer], "device not authorized");
        require(nonces[signer] == data.nonce, "invalid nonce");

        nonces[signer] = data.nonce + 1;

        // update context
        temperature = data.temperature;
        humidity = data.humidity;
        hour = data.hour;
        totalMeterSignal = data.totalMeterSignal;
        ac1Power = data.ac1Power;
        ac2Power = data.ac2Power;
        ac3Power = data.ac3Power;
        carBatteryPowerStatus = data.carBatteryPowerStatus;
        totalDevicesPowerValue = data.totalDevicesPowerValue;

        emit ContextUpdated(
            data.temperature,
            data.humidity,
            data.hour,
            data.totalMeterSignal,
            data.ac1Power,
            data.ac2Power,
            data.ac3Power,
            data.carBatteryPowerStatus
        );
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
        temperature = _temperature;
        humidity = _humidity;
        hour = _hour;
        totalMeterSignal = _totalMeterSignal;
        ac1Power = _ac1Power;
        ac2Power = _ac2Power;
        ac3Power = _ac3Power;
        carBatteryPowerStatus = _carBatteryPowerStatus;
        totalDevicesPowerValue = _totalDevicesPowerValue;

        emit ContextUpdated(
            _temperature,
            _humidity,
            _hour,
            _totalMeterSignal,
            _ac1Power,
            _ac2Power,
            _ac3Power,
            _carBatteryPowerStatus
        );
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
