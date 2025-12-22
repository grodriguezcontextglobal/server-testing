package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// --- Structs ---

type Receiver struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	Device        interface{}        `bson:"device" json:"device"`
	PaymentIntent string             `bson:"paymentIntent" json:"paymentIntent"`
	User          string             `bson:"user" json:"user"`
	Active        bool               `bson:"active" json:"active"`
	EventSelected []string           `bson:"eventSelected" json:"eventSelected"`
	Provider      []string           `bson:"provider" json:"provider"`
	Company       string             `bson:"company" json:"company"`
	TimeStamp     interface{}        `bson:"timeStamp" json:"timeStamp"`
	EventID       string             `bson:"event_id" json:"event_id"`
}

type ReceiverPool struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	EventSelected string             `bson:"eventSelected" json:"eventSelected"`
	Device        interface{}        `bson:"device" json:"device"`
	Type          string             `bson:"type" json:"type"`
	Status        string             `bson:"status" json:"status"`
	Activity      bool               `bson:"activity" json:"activity"`
	Comment       string             `bson:"comment" json:"comment"`
	Provider      string             `bson:"provider" json:"provider"`
	Company       string             `bson:"company" json:"company"`
	ContractType  string             `bson:"contract_type,omitempty" json:"contract_type,omitempty"`
}

type ReceiverReturnedStatus struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	Device        interface{}        `bson:"device" json:"device"`
	Status        string             `bson:"status" json:"status"`
	Activity      string             `bson:"activity" json:"activity"`
	Comment       string             `bson:"comment" json:"comment"`
	User          string             `bson:"user" json:"user"`
	Provider      string             `bson:"provider" json:"provider"`
	EventSelected string             `bson:"eventSelected" json:"eventSelected"`
	Admin         string             `bson:"admin" json:"admin"`
	TimeStamp     interface{}        `bson:"timeStamp" json:"timeStamp"`
}

// --- Controllers ---

func AddReceiverToTransaction(db *mongo.Database, data []byte) (interface{}, error) {
	var req Receiver
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, err
	}

	// Parse TimeStamp to time.Time
	req.TimeStamp = parseTime(req.TimeStamp)

	if !req.Active {
		req.Active = true
	}

	res, err := db.Collection("receivers").InsertOne(context.TODO(), req)
	if err != nil {
		return nil, err
	}
	req.ID = res.InsertedID.(primitive.ObjectID)
	return req, nil
}

func CreateBulkItemTransactionInUser(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		SerialNumbers string      `json:"serialNumbers"`
		DeviceType    string      `json:"deviceType"`
		Status        bool        `json:"status"` // In JS: device.status
		PaymentIntent string      `json:"paymentIntent"`
		Company       string      `json:"company"`
		User          string      `json:"user"`
		EventSelected string      `json:"eventSelected"`
		Provider      string      `json:"provider"`
		EventID       string      `json:"event_id"`
		TimeStamp     interface{} `json:"timestamp"`
	}

	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	var serialList []struct {
		Device string `json:"device"`
	}
	if err := json.Unmarshal([]byte(input.SerialNumbers), &serialList); err != nil {
		return nil, fmt.Errorf("invalid serialNumbers JSON: %v", err)
	}

	ts := parseTime(input.TimeStamp)

	var docs []interface{}
	for _, item := range serialList {
		docs = append(docs, Receiver{
			PaymentIntent: input.PaymentIntent,
			Device: map[string]interface{}{
				"deviceType":   input.DeviceType,
				"serialNumber": item.Device,
				"status":       input.Status,
			},
			Company:       input.Company,
			User:          input.User,
			EventSelected: []string{input.EventSelected},
			Provider:      []string{input.Provider},
			TimeStamp:     ts,
			EventID:       input.EventID,
			Active:        true,
		})
	}

	if len(docs) == 0 {
		return map[string]interface{}{"msg": "No items to insert"}, nil
	}

	_, err := db.Collection("receivers").InsertMany(context.TODO(), docs)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"ok":    true,
		"msg":   fmt.Sprintf("Items assigned successfully. Total items: %d", len(docs)),
		"count": len(docs),
	}, nil
}

func PoolReceiversBulk(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		DeviceList    string `json:"deviceList"`
		Status        string `json:"status"`
		Activity      bool   `json:"activity"`
		Comment       string `json:"comment"`
		EventSelected string `json:"eventSelected"`
		Provider      string `json:"provider"`
		Type          string `json:"type"`
		Company       string `json:"company"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	var rawDevices []interface{}
	if err := json.Unmarshal([]byte(input.DeviceList), &rawDevices); err != nil {
		return nil, err
	}

	var docs []interface{}
	var savedDocs []ReceiverPool
	for _, d := range rawDevices {
		oid := primitive.NewObjectID()
		doc := ReceiverPool{
			ID:            oid,
			Device:        d,
			Status:        input.Status,
			Activity:      input.Activity,
			Comment:       input.Comment,
			EventSelected: input.EventSelected,
			Provider:      input.Provider,
			Type:          input.Type,
			Company:       input.Company,
		}
		docs = append(docs, doc)
		savedDocs = append(savedDocs, doc)
	}

	if len(docs) == 0 {
		return nil, fmt.Errorf("no devices to insert")
	}

	_, err := db.Collection("receiverspools").InsertMany(context.TODO(), docs)
	if err != nil {
		return nil, err
	}
	// Return the saved documents to match Node.js behavior
	return savedDocs, nil
}

func EventList(db *mongo.Database, data []byte) (interface{}, error) {
	var filter bson.M
	if err := json.Unmarshal(data, &filter); err != nil {
		return nil, err
	}

	// Handle _id if it's a string, convert to ObjectID
	if idStr, ok := filter["_id"].(string); ok {
		if oid, err := primitive.ObjectIDFromHex(idStr); err == nil {
			filter["_id"] = oid
		}
	}

	cursor, err := db.Collection("events").Find(context.TODO(), filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.TODO())

	var results []bson.M
	if err = cursor.All(context.TODO(), &results); err != nil {
		return nil, err
	}
	return results, nil
}

func ReceiverPoolBulkDelete(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	var objIDs []primitive.ObjectID
	for _, id := range input.IDs {
		if oid, err := primitive.ObjectIDFromHex(id); err == nil {
			objIDs = append(objIDs, oid)
		}
	}

	if len(objIDs) == 0 {
		return nil, fmt.Errorf("no valid IDs provided")
	}

	res, err := db.Collection("receiverspools").DeleteMany(context.TODO(), bson.M{"_id": bson.M{"$in": objIDs}})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"ok": true, "deletedCount": res.DeletedCount}, nil
}

func ReceiverPoolFoundAndDelete(db *mongo.Database, data []byte) (interface{}, error) {
	// Expecting {"id": "..."} in body because logic was request.params.id
	// But helper will pass body. I need to make sure ID is passed.
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	oid, err := primitive.ObjectIDFromHex(input.ID)
	if err != nil {
		return nil, err
	}

	res := db.Collection("receiverspools").FindOneAndDelete(context.TODO(), bson.M{"_id": oid})
	if res.Err() != nil {
		return nil, res.Err()
	}
	var deletedDoc bson.M
	res.Decode(&deletedDoc)
	return map[string]interface{}{"ok": true, "deviceDeleted": deletedDoc}, nil
}

func ReturnAllItemsInTransactionInPool(db *mongo.Database, data []byte) (interface{}, error) {
	// JS logic is complex on 'device' structure.
	// "for (let item of device)"
	// filter: type: item.device.deviceType, device: item.device.serialNumber ?? item.device

	// Let's use map[string]interface{} to handle flexible input
	var rawInput map[string]interface{}
	if err := json.Unmarshal(data, &rawInput); err != nil {
		return nil, err
	}

	company, _ := rawInput["company"].(string)
	activity, _ := rawInput["activity"].(bool)
	eventSelected, _ := rawInput["eventSelected"].(string)
	deviceList, _ := rawInput["device"].([]interface{})

	var models []mongo.WriteModel
	for _, d := range deviceList {
		item := d.(map[string]interface{})

		var deviceType string
		var serialNumber interface{}

		// Extract nested device info
		if devObj, ok := item["device"].(map[string]interface{}); ok {
			deviceType, _ = devObj["deviceType"].(string)
			serialNumber = devObj["serialNumber"]
			if serialNumber == nil {
				// Fallback to item.device? No, JS says item.device.serialNumber ?? item.device
				// But item.device is the object.
				// Wait, JS: item.device.serialNumber ?? item.device
				// If item.device is string, it uses that.
				// If item.device is object, uses serialNumber.
				// But here item["device"] IS the object.
			}
		}

		// Re-reading JS:
		// item.device.deviceType
		// item.device.serialNumber ?? item.device

		// This implies 'item' has a property 'device'.
		// If item.device is an object, use its serialNumber.
		// If item.device is a string (unlikely if it has .serialNumber access attempt first? No, JS allows access on string, returns undefined).

		// Logic:
		itemDevice := item["device"]
		if itemDeviceMap, ok := itemDevice.(map[string]interface{}); ok {
			// It's an object
			deviceType, _ = itemDeviceMap["deviceType"].(string)
			serialNumber = itemDeviceMap["serialNumber"]
			if serialNumber == nil {
				serialNumber = itemDevice
			}
		} else {
			// It's likely a string or primitive
			serialNumber = itemDevice
			// deviceType? JS accesses item.device.deviceType. If item.device is string, this is undefined.
			// This suggests the input 'device' array contains objects wrapping the real info.
		}

		filter := bson.M{
			"company":       company,
			"activity":      !activity,
			"eventSelected": eventSelected,
			"type":          deviceType,
			"device":        serialNumber,
		}
		update := bson.M{"$set": bson.M{"activity": activity}}

		models = append(models, mongo.NewUpdateOneModel().SetFilter(filter).SetUpdate(update))
	}

	if len(models) > 0 {
		_, err := db.Collection("receiverspools").BulkWrite(context.TODO(), models)
		if err != nil {
			return nil, err
		}
	}

	return map[string]interface{}{"ok": true}, nil
}

func UpdateReceiverStatus(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		ID     string      `json:"id"`
		Device interface{} `json:"device"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	oid, err := primitive.ObjectIDFromHex(input.ID)
	if err != nil {
		return nil, err
	}

	update := bson.M{"$set": bson.M{"device": input.Device}}
	res := db.Collection("receivers").FindOneAndUpdate(context.TODO(), bson.M{"_id": oid}, update, options.FindOneAndUpdate().SetReturnDocument(options.After))
	if res.Err() != nil {
		return nil, res.Err()
	}
	var updatedDoc bson.M
	res.Decode(&updatedDoc)
	return map[string]interface{}{"ok": true, "receiver": updatedDoc}, nil
}

func UpdateBulkItemDataInPool(db *mongo.Database, data []byte) (interface{}, error) {
	// JS Logic:
	// find index of startingSerialNumber in deviceData
	// slice qty items
	// find matching items in DB
	// bulk update

	var input struct {
		StartingSerialNumber string `json:"startingSerialNumber"`
		DeviceData           string `json:"deviceData"` // JSON string
		Qty                  int    `json:"qty"`        // or string? JS uses Number(qty)
		Status               string `json:"status"`
		Activity             bool   `json:"activity"`
		Comment              string `json:"comment"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	var devices []struct {
		Device        string `json:"device"`
		Company       string `json:"company"`
		EventSelected string `json:"eventSelected"`
		Type          string `json:"type"`
		Provider      string `json:"provider"`
	}
	if err := json.Unmarshal([]byte(input.DeviceData), &devices); err != nil {
		return nil, err
	}

	startIndex := -1
	for i, d := range devices {
		if d.Device == input.StartingSerialNumber {
			startIndex = i
			break
		}
	}

	if startIndex == -1 {
		return nil, fmt.Errorf("Starting serial number not found")
	}

	endIndex := startIndex + input.Qty
	if endIndex > len(devices) {
		endIndex = len(devices)
	}

	targetDevices := devices[startIndex:endIndex]
	if len(targetDevices) == 0 {
		return map[string]interface{}{"ok": true, "msg": "No items to update"}, nil
	}

	// Optimization: Instead of finding then updating, just update based on the criteria for each item.
	// JS code did: find items matching list, then map updateData, then bulkWrite.
	// We can directly bulkWrite if we trust the input matches DB logic.
	// JS Filter: company, activity: false, eventSelected, type, device IN list.

	// Since each item might have different type/company/eventSelected (though likely same batch),
	// JS used data[0] for company/event/type.
	first := targetDevices[0]

	var deviceSerials []string
	for _, d := range targetDevices {
		deviceSerials = append(deviceSerials, d.Device)
	}

	filter := bson.M{
		"company":       first.Company,
		"activity":      false,
		"eventSelected": first.EventSelected,
		"type":          first.Type,
		"device":        bson.M{"$in": deviceSerials},
	}

	update := bson.M{
		"$set": bson.M{
			"status":   input.Status,
			"activity": true,
			"comment":  input.Comment,
		},
	}

	res, err := db.Collection("receiverspools").UpdateMany(context.TODO(), filter, update)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"ok":            true,
		"msg":           fmt.Sprintf("Total items updated successfully: %d", res.ModifiedCount),
		"totalAssigned": res.ModifiedCount,
		"modifiedCount": res.ModifiedCount,
	}, nil
}

func UpdateBulkItemsInPool(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		Device []struct {
			DeviceType   string      `json:"deviceType"` // JS: item.deviceType ?? item.type
			Type         string      `json:"type"`
			SerialNumber string      `json:"serialNumber"` // JS: item.serialNumber ?? item.device
			Device       interface{} `json:"device"`
		} `json:"device"`
		Company       string `json:"company"`
		Activity      bool   `json:"activity"`
		EventSelected string `json:"eventSelected"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	var models []mongo.WriteModel
	for _, item := range input.Device {
		t := item.DeviceType
		if t == "" {
			t = item.Type
		}

		d := item.SerialNumber
		if d == "" {
			if s, ok := item.Device.(string); ok {
				d = s
			}
		}

		filter := bson.M{
			"company":       input.Company,
			"activity":      !input.Activity,
			"eventSelected": input.EventSelected,
			"type":          t,
			"device":        d,
		}
		update := bson.M{"$set": bson.M{"activity": input.Activity}}
		models = append(models, mongo.NewUpdateOneModel().SetFilter(filter).SetUpdate(update))
	}

	if len(models) > 0 {
		res, err := db.Collection("receiverspools").BulkWrite(context.TODO(), models)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"ok": true, "modifiedCount": res.ModifiedCount}, nil
	}
	return map[string]interface{}{"ok": true, "modifiedCount": 0}, nil
}

func UpdateBulkItemsInTransaction(db *mongo.Database, data []byte) (interface{}, error) {
	var input struct {
		TimeStamp interface{} `json:"timeStamp"`
		Device    []struct {
			Key string `json:"key"` // JS uses item.key for ID
		} `json:"device"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	ts := parseTime(input.TimeStamp)

	var models []mongo.WriteModel
	for _, item := range input.Device {
		oid, err := primitive.ObjectIDFromHex(item.Key)
		if err != nil {
			continue
		}

		update := bson.M{
			"$set": bson.M{
				"device.status": false,
				"timeStamp":     ts,
			},
		}
		models = append(models, mongo.NewUpdateOneModel().SetFilter(bson.M{"_id": oid}).SetUpdate(update))
	}

	if len(models) > 0 {
		_, err := db.Collection("receivers").BulkWrite(context.TODO(), models)
		if err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{"ok": true}, nil
}

func parseTime(v interface{}) time.Time {
	if v == nil {
		return time.Now()
	}
	switch t := v.(type) {
	case string:
		// Try parsing different formats
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			return parsed
		}
		if parsed, err := time.Parse("2006-01-02", t); err == nil {
			return parsed
		}
		// Try parsing as int string
		if i, err := strconv.ParseInt(t, 10, 64); err == nil {
			return time.UnixMilli(i)
		}
		return time.Now()
	case float64:
		return time.UnixMilli(int64(t))
	case int64:
		return time.UnixMilli(t)
	case int:
		return time.UnixMilli(int64(t))
	default:
		return time.Now()
	}
}

func UpdateBulkItemsInTransactionPerUserAtOnce(db *mongo.Database, data []byte) (interface{}, error) {
	// 1. Try to unmarshal as a list of updates (User's payload format)
	// Check if data starts with '['
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		var listInput []struct {
			ID        string      `json:"id"`
			TimeStamp interface{} `json:"timeStamp"`
		}
		if err := json.Unmarshal(data, &listInput); err != nil {
			return nil, err
		}

		var models []mongo.WriteModel
		for _, item := range listInput {
			oid, err := primitive.ObjectIDFromHex(item.ID)
			if err != nil {
				continue
			}

			ts := parseTime(item.TimeStamp)
			update := bson.M{
				"$set": bson.M{
					"device.status": false,
					"timeStamp":     ts,
				},
			}
			models = append(models, mongo.NewUpdateOneModel().SetFilter(bson.M{"_id": oid}).SetUpdate(update))
		}

		if len(models) > 0 {
			_, err := db.Collection("receivers").BulkWrite(context.TODO(), models)
			if err != nil {
				return nil, err
			}
		}
		return map[string]interface{}{"ok": true}, nil
	}

	// 2. Original Object Logic (with TimeStamp fix)
	var input struct {
		TimeStamp interface{} `json:"timeStamp"`
		Device    []struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	ts := parseTime(input.TimeStamp)

	var models []mongo.WriteModel
	for _, item := range input.Device {
		oid, err := primitive.ObjectIDFromHex(item.ID)
		if err != nil {
			continue
		}

		update := bson.M{
			"$set": bson.M{
				"device.status": false,
				"timeStamp":     ts,
			},
		}
		models = append(models, mongo.NewUpdateOneModel().SetFilter(bson.M{"_id": oid}).SetUpdate(update))
	}

	if len(models) > 0 {
		_, err := db.Collection("receivers").BulkWrite(context.TODO(), models)
		if err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{"ok": true}, nil
}

func UpdateIssueDevice(db *mongo.Database, data []byte) (interface{}, error) {
	// Unmarshal to map first
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	idStr, _ := raw["id"].(string)
	if idStr == "" {
		return nil, fmt.Errorf("id is required")
	}
	delete(raw, "id") // Remove ID from updates

	oid, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		return nil, err
	}

	res := db.Collection("receiverreturnedstatuses").FindOneAndUpdate(
		context.TODO(),
		bson.M{"_id": oid},
		bson.M{"$set": raw},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	)
	if res.Err() != nil {
		return nil, res.Err()
	}
	var doc bson.M
	res.Decode(&doc)
	return map[string]interface{}{"ok": true, "receiverUpdated": doc}, nil
}

func UpdatePoolReceivers(db *mongo.Database, data []byte) (interface{}, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	idStr, _ := raw["id"].(string)
	if idStr == "" {
		return nil, fmt.Errorf("id is required")
	}
	delete(raw, "id")

	oid, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		return nil, err
	}

	res := db.Collection("receiverspools").FindOneAndUpdate(
		context.TODO(),
		bson.M{"_id": oid},
		bson.M{" $set": raw},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	)
	if res.Err() != nil {
		return nil, res.Err()
	}
	var doc bson.M
	res.Decode(&doc)
	return map[string]interface{}{"ok": true, "receiverUpdated": doc}, nil // JS returns stringified, but JSON response will be object
}

func GetConsumerStats(db *mongo.Database, data []byte) (interface{}, error) {
	var req struct {
		CompanyID string `json:"companyID"`
	}
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, err
	}

	// 1. Get Users
	cursor, err := db.Collection("users").Find(context.TODO(), bson.M{"company_providers": bson.M{"$in": []string{req.CompanyID}}})
	if err != nil {
		return nil, err
	}
	var users []map[string]interface{}
	if err = cursor.All(context.TODO(), &users); err != nil {
		return nil, err
	}

	// 2. Get Lease Count
	leaseCount, err := db.Collection("events").CountDocuments(context.TODO(), bson.M{"company_id": req.CompanyID, "type": "lease"})
	if err != nil {
		return nil, err
	}

	// 3. Get Active Events for Company (ID set)
	eventCursor, err := db.Collection("events").Find(context.TODO(), bson.M{"company_id": req.CompanyID, "active": true}, options.Find().SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return nil, err
	}
	var activeEvents []struct {
		ID primitive.ObjectID `bson:"_id"`
	}
	if err = eventCursor.All(context.TODO(), &activeEvents); err != nil {
		return nil, err
	}
	activeEventMap := make(map[string]bool)
	for _, e := range activeEvents {
		activeEventMap[e.ID.Hex()] = true
	}

	// 4. Aggregation for Receivers
	// Group by user and device.status
	// Note: device.status is sometimes boolean, sometimes string in legacy data?
	// JS code uses boolean: "device.status": false / true
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"company": req.CompanyID}}},
		{{Key: "$group", Value: bson.M{
			"_id":   bson.M{"user": "$user", "status": "$device.status"},
			"count": bson.M{"$sum": 1},
		}}},
	}
	recvCursor, err := db.Collection("receivers").Aggregate(context.TODO(), pipeline)
	if err != nil {
		return nil, err
	}
	var recvStats []struct {
		ID struct {
			User   string      `bson:"user"`
			Status interface{} `bson:"status"` // Can be bool or maybe null?
		} `bson:"_id"`
		Count int `bson:"count"`
	}
	if err = recvCursor.All(context.TODO(), &recvStats); err != nil {
		return nil, err
	}

	// Map: UserEmail -> Status(bool) -> Count
	userRecvStats := make(map[string]map[bool]int)
	for _, stat := range recvStats {
		if _, ok := userRecvStats[stat.ID.User]; !ok {
			userRecvStats[stat.ID.User] = make(map[bool]int)
		}
		// Convert status to bool if possible
		var statusBool bool
		switch v := stat.ID.Status.(type) {
		case bool:
			statusBool = v
		default:
			// If null or other type, treat as false?
			// JS query specifically looks for `false` and `true`.
			// If it's not strictly true/false, it won't be counted in JS.
			// However, here we have aggregated everything.
			// Let's only count if it matches boolean type, matching JS strict query?
			// JS: find({ "device.status": false })
			// Mongo $eq matches types.
			continue
		}
		userRecvStats[stat.ID.User][statusBool] = stat.Count
	}

	// 5. Construct Result
	var resultUsers []map[string]interface{}
	var inactiveTotal, activeTotal int

	for _, user := range users {
		email, _ := user["email"].(string)

		// Handle event_providers which can be []interface{}
		var eventProviders []string
		if epRaw, ok := user["event_providers"].(primitive.A); ok {
			for _, v := range epRaw {
				if s, ok := v.(string); ok {
					eventProviders = append(eventProviders, s)
				}
			}
		}

		// Calculate Event Active Count
		activeEventCount := 0
		for _, epStr := range eventProviders {
			if activeEventMap[epStr] {
				activeEventCount++
			}
		}

		// Calculate Receiver Counts
		stats := userRecvStats[email]
		inactive := stats[false]
		active := stats[true]

		inactiveTotal += inactive
		activeTotal += active

		// Add fields
		user["totalDeviceRequested"] = inactive + active
		user["totalEventsActive"] = activeEventCount

		resultUsers = append(resultUsers, user)
	}

	result := map[string]interface{}{
		"inactiveTransactions":     inactiveTotal,
		"activeTransactions":       activeTotal,
		"total":                    inactiveTotal + activeTotal,
		"totalConsumers":           len(users),
		"usersList":                resultUsers,
		"totalConsumersFromEvents": len(users),
		"lease":                    leaseCount,
	}

	return result, nil
}
