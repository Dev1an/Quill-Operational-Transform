import { Mongo } from 'meteor/mongo'
import { Template } from 'meteor/templating'
import { ReactiveVar } from 'meteor/reactive-var'
import { EJSON } from 'meteor/ejson'

import './main.html'
import 'quill/dist/quill.snow.css'

import Quill from 'quill'
import Delta from 'quill-delta'

const Deltas = new Mongo.Collection(null);
const TemporaryDeltas = new Mongo.Collection(null, {transform: doc => {doc.isTemporary = true; return doc}});
Deltas.insert(serialise(new Delta()))

let editor
let cursor = new ReactiveVar(null)
let temporaryCursor = new ReactiveVar(null)
let temporaryAnchor = new ReactiveVar(null)

Template.DeltaEditor.helpers({
    deltas() { return Deltas.find({}, {sort: {sequenceNumber: 1}}) },
})

Template.DeltaView.helpers({
    operationView() {
        if ('insert' in this) {
            return 'InsertOperation'
        } else if ('retain' in this) {
            return 'RetainOperation'
        } else if ('delete' in this) {
            return 'DeleteOperation'
        } else {
            return 'UnknownOperation'
        }
    },
    containsCursor() {
        return (this.isTemporary ? temporaryCursor.get() : cursor.get()) == this._id
    },
    containsTemporary() {
        return temporaryAnchor.get() == this._id
    },
    deltas() {
        return TemporaryDeltas.find()
    },
    temporary() {return TemporaryDeltas.find()}
})

Template.DeltaView.events({
    'click li'(event, {data}) {
        event.stopImmediatePropagation()
        updateCursor(data)
    },

    'click button'(event, {data: {_id: id}}) {
        event.stopImmediatePropagation()
        const composite = TemporaryDeltas
            .find().fetch()
            .reduce(deserialiseAndCompose, new Delta())
        const serialComposite = serialise(composite)

        const anchor = Deltas.findOne(temporaryAnchor.get())
        const afterAnchor = Deltas.find({sequenceNumber: {$gt: anchor.sequenceNumber}}, {sort: {sequenceNumber: 1}}).fetch()

        const difference = afterAnchor[0].sequenceNumber - anchor.sequenceNumber
        serialComposite.sequenceNumber = anchor.sequenceNumber + difference/2
        Deltas.insert(serialComposite)
        TemporaryDeltas.remove({})
        temporaryAnchor.set(null)
        temporaryCursor.set(null)

        afterAnchor.forEach( object => {
            console.log("transforming", object)
            let delta = new Delta(object.ops)
            Deltas.update(object._id, {$set: {ops: composite.transform(delta, true).ops}})
        })

        const currentCursor = cursor.get()
        if (currentCursor == null) {
            updateCursor(Deltas.findOne({}, {sort: {sequenceNumber: -1}}))
        } else {
            updateCursor(Deltas.findOne(currentCursor))
        }
    }
})

function updateCursor({_id: id, sequenceNumber, isTemporary}) {
    const query = {sequenceNumber: {$lte: sequenceNumber}}
    if (isTemporary) {
        temporaryCursor.set(id)
        const anchor = Deltas.findOne(temporaryAnchor.get())
        cursor.set(anchor._id)
        const content = Deltas
            .find({sequenceNumber: {$lte: anchor.sequenceNumber}}).fetch()
            .reduce(deserialiseAndCompose, new Delta())
        const tempContent = TemporaryDeltas
            .find(query).fetch()
            .reduce(deserialiseAndCompose, content)
        editor.setContents(tempContent, "silent")
    } else {
        cursor.set(id == Deltas.findOne({}, {sort: {sequenceNumber: -1}})._id ? null : id)
        temporaryCursor.set(null)
        const content = Deltas
            .find(query, {sort: {sequenceNumber: 1}}).fetch()
            .reduce(deserialiseAndCompose, new Delta())
        editor.setContents(content, "silent")
    }
}

Template.TextEditor.onRendered(function() {
	editor = new Quill(this.find('div'))

	editor.on('text-change', function(delta) {
	    if (cursor.get() == null) {
            Deltas.insert(serialise(delta))
        } else {
	        temporaryAnchor.set(cursor.get())
            temporaryCursor.set(TemporaryDeltas.insert(serialise(delta)))
        }
	})
})

function serialise(delta) {
    delta.sequenceNumber = new Date().getTime()
    return EJSON.clone(delta)
}

function deserialiseAndCompose(composite, object) {
    return composite.compose(new Delta(object.ops))
}

